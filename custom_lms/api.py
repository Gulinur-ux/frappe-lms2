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
    
    # Video progressni xavfsiz olish
    video_map = {}
    if frappe.db.exists("DocType", "LMS Video Progress"):
        try:
            video_progress = frappe.get_all("LMS Video Progress", fields=["user", "lesson", "playback_speed", "modified"])
            video_map = {(v.user, v.lesson): v for v in video_progress}
        except Exception:
            pass
    
    # Quiz ma'lumotlari
    quiz_subs = frappe.get_all("LMS Quiz Submission", fields=["member", "quiz", "score"], order_by="creation asc")
    quiz_map = {}
    for q in quiz_subs:
        key = (q.member, q.quiz)
        if key not in quiz_map: quiz_map[key] = {"attempts": 0, "best": 0, "passed_at": None}
        quiz_map[key]["attempts"] += 1
        quiz_map[key]["best"] = max(quiz_map[key]["best"], q.score)
        if q.score >= 100 and not quiz_map[key]["passed_at"]: quiz_map[key]["passed_at"] = quiz_map[key]["attempts"]

    results = []
    total_lessons_count = 0
    for en in enrollments:
        lesson_filters = {"course": en.course}
        if lesson: lesson_filters["name"] = lesson
        lessons = frappe.get_all("Course Lesson", filters=lesson_filters, fields=["name", "title", "quiz_id"])
        
        # Accumulate total lessons for context, or just use per-course count? 
        # The prompt implies a global total. If filtering by course, it's fine.
        # If showing multiple courses, maybe we should sum them up?
        # But 'total_lessons' is a global metric in the response.
        # Let's accumulate it.
        total_lessons_count += len(lessons)
        
        student_data = {
            "student": en.member,
            "student_name": frappe.get_value("User", en.member, "full_name") or en.member,
            "course_name": frappe.get_value("LMS Course", en.course, "title"),
            "completed_count": 0,
            "lesson_details": []
        }
        
        for l in lessons:
            is_comp = frappe.db.exists("LMS Lesson Completion", {"member": en.member, "lesson": l.name})
            if is_comp: student_data["completed_count"] += 1
            
            v = video_map.get((en.member, l.name))
            q = quiz_map.get((en.member, l.quiz_id)) if l.quiz_id else None
            
            student_data["lesson_details"].append({
                "lesson_title": l.title,
                "is_completed": 1 if is_comp else 0,
                "video_speed": v.playback_speed if v else "N/A",
                "last_activity": frappe.utils.pretty_date(v.modified) if v else "Never",
                "quiz_attempts": q["attempts"] if q else "-",
                "quiz_score": f"{q['best']}%" if q else "N/A",
                "quiz_passed": q["passed_at"] if q else None
            })
        results.append(student_data)

    return {"students": results, "total_lessons": total_lessons_count, "total_students": len(results)}
