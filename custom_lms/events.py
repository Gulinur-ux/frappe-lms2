import frappe

def publish_lesson_completion(doc, method):
    """
    Publish event when a lesson is completed.
    This handles both 'on_update' (if status changes) or 'on_submit'.
    Since the dashboard needs to know WHICH student and lesson, we send that data.
    """
    frappe.publish_realtime("lesson_completion_update", {
        "student": doc.member,
        "lesson": doc.lesson,
        "course": doc.course 
    })

def publish_quiz_submission(doc, method):
    """
    Publish event when a quiz is submitted.
    """
    frappe.publish_realtime("quiz_submission_update", {
        "student": doc.member,
        "quiz": doc.quiz,
        # 'course' might not be directly on quiz submission depending on schema, 
        # but usually it's linked or we can fetch it if needed. 
        # For refresh trigger, just the event is usually enough if we are loose on filters.
    })
