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
    
    # Total Students calculation (Unique)
    student_count_sql = """
        SELECT COUNT(DISTINCT member) FROM `tabLMS Enrollment`
        WHERE 1=1
    """
    sql_args = []
    if course:
        student_count_sql += " AND course = %s"
        sql_args.append(course)
    if student:
        student_count_sql += " AND member = %s"
        sql_args.append(student)
        
    total_students_count = frappe.db.sql(student_count_sql, tuple(sql_args))[0][0]


    
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

    # Video analytics data
    analytics_filters = {}
    if student: analytics_filters["user"] = student
    
    analytics_data = frappe.get_all("LMS Video Analytics", filters=analytics_filters, 
                                   fields=["user", "lesson", "engagement_score", "watch_percentage", "seek_count", "total_watch_time"],
                                   order_by="creation desc")
    analytics_map = {}
    for a in analytics_data:
        # Use the latest record for each lesson
        key = (a.user, a.lesson)
        if key not in analytics_map:
            analytics_map[key] = a

    results = []
    total_lessons_count = 0
    
    # Pre-fetch valid courses for performance
    valid_courses_map = {c.name: c.title for c in frappe.get_all("LMS Course", fields=["name", "title"])}
    
    for en in enrollments:
        if en.course not in valid_courses_map:
            continue
            
        lesson_filters = {"course": en.course}
        if lesson: lesson_filters["name"] = lesson
        lessons = frappe.get_all("Course Lesson", filters=lesson_filters, fields=["name", "title", "quiz_id"])
        
        total_lessons_count += len(lessons)
        course_title = valid_courses_map.get(en.course) or en.course
        
        student_data = {
            "student": en.member,
            "student_name": frappe.get_value("User", en.member, "full_name") or en.member,
            "course_name": course_title,
            "course": en.course,
            "completed_count": 0,
            "total_course_lessons": len(lessons),
            "lesson_details": [],
            "last_activity": None,
            "avg_engagement": 0
        }
        
        latest_activity = None
        total_engagement = 0
        engagement_count = 0
        
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
            
            # Analytics
            analytics = analytics_map.get((en.member, l.name))
            engagement_score = analytics.engagement_score if analytics else 0
            if analytics:
                total_engagement += engagement_score
                engagement_count += 1
            
            student_data["lesson_details"].append({
                "lesson_title": l.title,
                "is_completed": 1 if is_comp else 0,
                "status": prog.status if prog else "Not Started",
                "video_speed": v.playback_speed if v else "N/A",
                "last_activity": frappe.utils.pretty_date(prog.modified) if prog else "Never",
                "quiz_attempts": q["attempts"] if q else "-",
                "quiz_score": f"{q['best']}%" if q else "N/A",
                "quiz_passed": q["passed_at"] if q else None,
                "engagement_score": engagement_score,
                "watch_percentage": f"{analytics.watch_percentage}%" if analytics else "0%",
                "seek_count": analytics.seek_count if analytics else 0
            })
        
        # Calculate progress percentage
        if len(lessons) > 0:
            student_data["progress_percent"] = round((student_data["completed_count"] / len(lessons)) * 100, 1)
        else:
            student_data["progress_percent"] = 0
            
        student_data["avg_engagement"] = round(total_engagement / engagement_count, 1) if engagement_count > 0 else 0
        
        student_data["last_activity"] = frappe.utils.pretty_date(latest_activity) if latest_activity else "Never"
        results.append(student_data)

    # Total Courses calculation (Unique) - Only count valid/existing courses
    valid_courses = frappe.get_all("LMS Course", fields=["name"], pluck="name")
    unique_enrolled_courses = set(e.course for e in enrollments)
    # Intersection of enrolled courses and valid courses
    valid_enrolled_courses = unique_enrolled_courses.intersection(set(valid_courses))
    
    total_courses_count = len(valid_enrolled_courses)

    return {"students": results, "total_lessons": total_lessons_count, "total_students": total_students_count, "total_courses": total_courses_count}

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

@frappe.whitelist()
def save_video_analytics(data):
    """
    Saves video analytics data sent from frontend.
    Data structure expected:
    {
        "lesson": "lesson_name",
        "course": "course_name",
        "video_duration": 120.5,
        "watch_percentage": 50.5,
        "total_watch_time": 60.2,
        "seek_count": 2,
        "pause_count": 1,
        "playback_speed": 1.5,
        "page_time_spent": 300.0
    }
    """
    import json
    if isinstance(data, str):
        data = json.loads(data)
        
    user = frappe.session.user
    if user == "Guest":
        return {"status": "error", "message": "Guest user"}
        
    lesson = data.get("lesson")
    course = data.get("course")
    
    if not lesson or not course:
        return {"status": "error", "message": "Missing lesson or course"}

    from frappe.utils import today
    
    # Check for existing record created today
    existing = frappe.db.count("LMS Video Analytics", {
        "user": user,
        "lesson": lesson,
        "course": course,
        "creation": (">", today()) 
    })
    
    if existing:
        # Get the latest one
        name = frappe.db.get_value("LMS Video Analytics", {
            "user": user, 
            "lesson": lesson, 
            "course": course,
            "creation": (">", today())
        }, "name", order_by="creation desc")
        doc = frappe.get_doc("LMS Video Analytics", name)
    else:
        doc = frappe.new_doc("LMS Video Analytics")
        doc.user = user
        doc.lesson = lesson
        doc.course = course
        doc.started_at = frappe.utils.now()

    # Update metrics - simple logic: trust frontend cumulative data
    doc.video_duration = data.get("video_duration", 0)
    
    # Take max of existing or new watch %
    doc.watch_percentage = max(doc.watch_percentage or 0, data.get("watch_percentage", 0))
    
    doc.total_watch_time = data.get("total_watch_time", 0)
    doc.seek_count = data.get("seek_count", 0)
    doc.pause_count = data.get("pause_count", 0)
    
    if data.get("playback_speed"):
        doc.playback_speed = data.get("playback_speed")
        
    doc.page_time_spent = data.get("page_time_spent", 0)
    
    if data.get("completed"):
        doc.completed_at = frappe.utils.now()
        
    doc.save(ignore_permissions=True)
    
    return {"status": "ok", "message": "Analytics saved", "name": doc.name}
