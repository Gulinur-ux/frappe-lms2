frappe.pages['student-progress-dashboard'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('Student Progress Dashboard'),
        single_column: true
    });

    const $container = $(wrapper).find('.layout-main-section');
    $container.html(`
        <div class="p-4">
            <div class="row mb-3">
                <div class="col-md-4"><div id="filter-course"></div></div>
                <div class="col-md-4"><div id="filter-student"></div></div>
                <div class="col-md-4"><div id="filter-lesson"></div></div>
            </div>
            <div class="row mb-4">
                <div class="col-md-6"><div class="p-3 bg-white border rounded"><h6>Total Students</h6><h2 id="stat-s">0</h2></div></div>
                <div class="col-md-6"><div class="p-3 bg-white border rounded"><h6>Total Lessons</h6><h2 id="stat-l">0</h2></div></div>
            </div>
            <div class="bg-white border rounded overflow-hidden">
                <table class="table table-hover m-0">
                    <thead class="bg-light">
                        <tr>
                            <th>Student</th>
                            <th>Overall Progress</th>
                            <th>Completed Lessons</th>
                            <th>Recent Activity</th>
                        </tr>
                    </thead>
                    <tbody id="dash-body"></tbody>
                </table>
            </div>
        </div>
    `);

    let course_f, student_f, lesson_f;

    const make_filter = (container, fieldname, label, options) => {
        let f = frappe.ui.form.make_control({
            parent: $(container),
            df: {
                fieldname,
                label,
                fieldtype: 'Link',
                options,
                change: () => refresh()
            },
            render_input: true
        });
        f.refresh();
        // Link fieldlar uchun awesomplete event
        if (f.$input && f.$input[0] && f.$input[0].awesomplete) {
            f.$input[0].awesomplete.on('selectcomplete', () => refresh());
        }
        // Qo'shimcha: input blur event
        if (f.$input) {
            f.$input.on('blur', () => setTimeout(refresh, 100));
        }
        return f;
    };

    course_f = make_filter('#filter-course', 'course', 'Course', 'LMS Course');
    student_f = make_filter('#filter-student', 'student', 'Student', 'User');
    lesson_f = make_filter('#filter-lesson', 'lesson', 'Lesson', 'Course Lesson');

    const refresh = () => {
        const filters = {
            course: course_f.get_value(),
            student: student_f.get_value(),
            lesson: lesson_f.get_value()
        };
        console.log("Refreshing with filters:", filters);

        frappe.call({
            method: 'custom_lms.api.get_student_dashboard_data',
            args: filters,
            callback: (r) => {
                const d = r.message;
                if (!d) return;

                $('#stat-s').text(d.total_students || 0);
                $('#stat-l').text(d.total_lessons || 0);
                const $body = $('#dash-body').empty();

                if (!d.students || d.students.length === 0) {
                    $body.append('<tr><td colspan="4" class="text-center text-muted p-3">No data found</td></tr>');
                    return;
                }

                d.students.forEach((s, idx) => {
                    const progress = s.progress_percent || 0;
                    const row_id = `details-${idx}`;
                    const displayName = s.student_name && s.student_name !== 'null' ? s.student_name : s.student;

                    $body.append(`
                        <tr class="clickable-row" style="cursor:pointer" onclick="$('#${row_id}').toggle()">
                            <td>
                                <b>${displayName}</b><br>
                                <small class="text-muted">${s.course_name || ''}</small>
                            </td>
                            <td>
                                <div class="progress" style="height:18px">
                                    <div class="progress-bar ${progress >= 100 ? 'bg-success' : 'bg-primary'}" style="width:${progress}%">${progress}%</div>
                                </div>
                                <small class="text-muted">${progress}% completed</small>
                            </td>
                            <td>${s.completed_count} of ${s.total_course_lessons || 0} completed</td>
                            <td>${s.last_activity || 'Never'}</td>
                        </tr>
                        <tr id="${row_id}" style="display:none; background:#f9f9f9">
                            <td colspan="4" class="p-4">
                                <h6>Lesson Details</h6>
                                <table class="table table-sm table-bordered bg-white">
                                    <thead><tr><th>Lesson</th><th>Status</th><th>Speed</th><th>Quiz</th><th>Activity</th></tr></thead>
                                    <tbody>
                                        ${s.lesson_details.map(ld => `
                                            <tr>
                                                <td>${ld.lesson_title}</td>
                                                <td><span class="badge ${ld.is_completed ? 'bg-success' : 'bg-warning'}">${ld.is_completed ? 'Completed' : 'Pending'}</span></td>
                                                <td>${ld.video_speed}</td>
                                                <td>${ld.quiz_score} (${ld.quiz_attempts} att)</td>
                                                <td>${ld.last_activity}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </td>
                        </tr>
                    `);
                });
            }
        });
    };

    // Real-time setup
    const setup_realtime = (event_name) => {
        frappe.realtime.on(event_name, (data) => {
            console.log(`Real-time event: ${event_name}`, data);
            frappe.show_alert({ message: __(`Update: ${event_name}`), indicator: 'green' });
            refresh();
        });
    };

    setup_realtime("lesson_completion_update");
    setup_realtime("quiz_submission_update");
    setup_realtime("video_progress_update");
    setup_realtime("update_lesson_progress"); // LMS native event

    // Connection check
    frappe.realtime.on('connect', () => {
        console.log("Real-time connected!");
        frappe.show_alert({ message: __("Real-time connected!"), indicator: 'blue' });
    });

    refresh();
};
