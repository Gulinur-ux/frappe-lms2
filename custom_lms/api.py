import frappe
from frappe import _

@frappe.whitelist()
def update_video_progress(lesson, video_url, last_time, playback_speed, is_completed=0):
    user = frappe.session.user
    if user == "Guest": return
    
    # DocType mavjudligini tekshirish
    if not frappe.db.exists("DocType", "LMS Video Progress"):
        return "DocType Missing"

    progress = frappe.get_all("LMS Video Progress", filters={"user": user, "lesson": lesson}, fields=["name"])
    if progress:
        doc = frappe.get_doc("LMS Video Progress", progress[0].name)
        doc.last_time = last_time
        doc.playback_speed = playback_speed
        if int(is_completed): doc.is_completed = 1
        doc.save(ignore_permissions=True)
    else:
        frappe.get_doc({
            "doctype": "LMS Video Progress", 
            "user": user, 
            "lesson": lesson, 
            "video_url": video_url, 
            "last_time": last_time, 
            "playback_speed": playback_speed, 
            "is_completed": int(is_completed)
        }).insert(ignore_permissions=True)
    
    frappe.publish_realtime("video_progress_update", {"lesson": lesson}, user=user)
    return "OK"

@frappe.whitelist()
def get_student_dashboard_data(course=None, student=None, lesson=None):
    enrollment_filters = {}
    if course: enrollment_filters["course"] = course
    if student: enrollment_filters["member"] = student
    
    enrollments = frappe.get_all("LMS Enrollment", filters=enrollment_filters, fields=["name", "course", "member"])
    
    # Video progress
    video_filters = {}
    if student: video_filters["user"] = student
    
    video_map = {}
    if frappe.db.exists("DocType", "LMS Video Progress"):
        try:
            video_progress = frappe.get_all("LMS Video Progress", filters=video_filters, fields=["user", "lesson", "playback_speed", "modified"])
            video_map = {(v.user, v.lesson): v for v in video_progress}
        except Exception:
            pass
    
    # LMS Course Progress (lesson completion tracking)
    progress_filters = {}
    if student: progress_filters["member"] = student
    
    course_progress = frappe.get_all("LMS Course Progress", filters=progress_filters, fields=["member", "lesson", "course", "status", "modified"])
    progress_map = {(p.member, p.lesson): p for p in course_progress}
    
    # Quiz data
    quiz_filters = {}
    if student: quiz_filters["member"] = student
    
    quiz_subs = frappe.get_all("LMS Quiz Submission", filters=quiz_filters, fields=["member", "quiz", "percentage"], order_by="creation asc")
    quiz_map = {}
    for q in quiz_subs:
        key = (q.member, q.quiz)
        if key not in quiz_map: quiz_map[key] = {"attempts": 0, "best": 0, "passed_at": None}
        quiz_map[key]["attempts"] += 1
        quiz_map[key]["best"] = max(quiz_map[key]["best"], q.percentage or 0)
        if (q.percentage or 0) >= 100 and not quiz_map[key]["passed_at"]: quiz_map[key]["passed_at"] = quiz_map[key]["attempts"]

    # Lesson -> Quiz mapping (LMS Quiz.lesson field)
    lesson_quizzes = frappe.get_all("LMS Quiz", fields=["name", "lesson"])
    lesson_quiz_map = {lq.lesson: lq.name for lq in lesson_quizzes if lq.lesson}

    results = []
    total_lessons_count = 0
    for en in enrollments:
        lesson_filters = {"course": en.course}
        if lesson: lesson_filters["name"] = lesson
        lessons = frappe.get_all("Course Lesson", filters=lesson_filters, fields=["name", "title", "quiz_id"])
        
        total_lessons_count += len(lessons)
        course_title = frappe.get_value("LMS Course", en.course, "title") or en.course
        
        student_data = {
            "student": en.member,
            "student_name": frappe.get_value("User", en.member, "full_name") or en.member,
            "course_name": course_title,
            "course": en.course,
            "completed_count": 0,
            "total_course_lessons": len(lessons),
            "lesson_details": [],
            "last_activity": None
        }
        
        latest_activity = None
        for l in lessons:
            prog = progress_map.get((en.member, l.name))
            is_comp = prog and prog.status == "Complete"
            if is_comp: student_data["completed_count"] += 1
            
            # Track latest activity
            if prog and prog.modified:
                if not latest_activity or prog.modified > latest_activity:
                    latest_activity = prog.modified
            
            v = video_map.get((en.member, l.name))
            # Quiz lookup: first try lesson_quiz_map (LMS Quiz.lesson), then Course Lesson.quiz_id
            quiz_name = lesson_quiz_map.get(l.name) or l.quiz_id
            q = quiz_map.get((en.member, quiz_name)) if quiz_name else None
            
            student_data["lesson_details"].append({
                "lesson_title": l.title,
                "is_completed": 1 if is_comp else 0,
                "status": prog.status if prog else "Not Started",
                "video_speed": v.playback_speed if v else "N/A",
                "last_activity": frappe.utils.pretty_date(prog.modified) if prog else "Never",
                "quiz_attempts": q["attempts"] if q else "-",
                "quiz_score": f"{q['best']}%" if q else "N/A",
                "quiz_passed": q["passed_at"] if q else None
            })
        
        # Calculate progress percentage
        if len(lessons) > 0:
            student_data["progress_percent"] = round((student_data["completed_count"] / len(lessons)) * 100, 1)
        else:
            student_data["progress_percent"] = 0
        
        student_data["last_activity"] = frappe.utils.pretty_date(latest_activity) if latest_activity else "Never"
        results.append(student_data)

    return {"students": results, "total_lessons": total_lessons_count, "total_students": len(results)}

@frappe.whitelist()
def track_lesson_view(lesson, course):
    """
    Dars ochilganda chaqiriladi.
    LMS Course Progress ga "Partially Complete" status bilan yozadi.
    """
    user = frappe.session.user
    if user == "Guest":
        return {"status": "error", "message": "Guest user"}
    
    # Enrollment tekshirish
    if not frappe.db.exists("LMS Enrollment", {"course": course, "member": user}):
        return {"status": "error", "message": "Not enrolled"}
    
    # Progress mavjudligini tekshirish
    existing = frappe.db.exists("LMS Course Progress", {"lesson": lesson, "member": user})
    
    if not existing:
        # Yangi progress yaratish
        doc = frappe.get_doc({
            "doctype": "LMS Course Progress",
            "lesson": lesson,
            "member": user,
            "status": "Partially Complete"
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        
        # Real-time event yuborish
        frappe.publish_realtime("lesson_completion_update", {
            "student": user,
            "lesson": lesson,
            "course": course,
            "status": "Partially Complete"
        })
        
        return {"status": "ok", "message": "Progress created"}
    
    return {"status": "ok", "message": "Already tracked"}

@frappe.whitelist()
def mark_lesson_complete(lesson, course):
    """
    Dars tugatilganda chaqiriladi.
    LMS Course Progress ni "Complete" ga o'zgartiradi va Enrollment progress ni yangilaydi.
    """
    user = frappe.session.user
    if user == "Guest":
        return {"status": "error", "message": "Guest user"}
    
    # Enrollment tekshirish
    enrollment_name = frappe.db.get_value("LMS Enrollment", {"course": course, "member": user}, "name")
    if not enrollment_name:
        return {"status": "error", "message": "Not enrolled"}
    
    # Progress mavjudligini tekshirish
    existing = frappe.db.get_value("LMS Course Progress", {"lesson": lesson, "member": user}, "name")
    
    if existing:
        frappe.db.set_value("LMS Course Progress", existing, "status", "Complete")
    else:
        doc = frappe.get_doc({
            "doctype": "LMS Course Progress",
            "lesson": lesson,
            "member": user,
            "status": "Complete"
        })
        doc.insert(ignore_permissions=True)
    
    frappe.db.commit()
    
    # LMS Enrollment progress ni yangilash (course card uchun)
    try:
        from lms.lms.utils import get_course_progress
        progress = get_course_progress(course, user)
        frappe.db.set_value("LMS Enrollment", enrollment_name, "progress", progress)
        frappe.db.commit()
    except Exception as e:
        frappe.log_error(f"Progress update error: {e}")
    
    # Real-time event yuborish
    frappe.publish_realtime("lesson_completion_update", {
        "student": user,
        "lesson": lesson,
        "course": course,
        "status": "Complete"
    })
    
    return {"status": "ok", "message": "Lesson completed"}
