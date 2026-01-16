frappe.pages['student-progress-dashboard'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __('Student Progress Dashboard'),
        single_column: true
    });

    // Clear standard fields if any (manual approach since we are replacing logic)
    page.clear_fields && page.clear_fields();

    const $container = $(wrapper).find('.layout-main-section');
    $container.html(`
        <div class="p-4 bg-light">
            <div class="row mb-3">
                <div class="col-md-4" id="filter-course"></div>
                <div class="col-md-4" id="filter-student"></div>
                <div class="col-md-4" id="filter-lesson"></div>
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

    // Initialize custom controls
    const make_filter = (parent, label, fieldname, options) => {
        return frappe.ui.form.make_control({
            parent: $(parent),
            df: {
                label: label,
                fieldname: fieldname,
                fieldtype: 'Link',
                options: options,
                change: () => refresh()
            },
            render_input: true
        });
    };

    let course_f = make_filter('#filter-course', __('Course'), 'course', 'LMS Course');
    let student_f = make_filter('#filter-student', __('Student'), 'student', 'User');
    let lesson_f = make_filter('#filter-lesson', __('Lesson'), 'lesson', 'Course Lesson');

    const refresh = () => {
        frappe.call({
            method: 'custom_lms.api.get_student_dashboard_data',
            args: {
                course: course_f.get_value(),
                student: student_f.get_value(),
                lesson: lesson_f.get_value()
            },
            callback: (r) => {
                const d = r.message;
                $('#stat-s').text(d.total_students);
                $('#stat-l').text(d.total_lessons);
                const $body = $('#dash-body').empty();

                if (!d.students || d.students.length === 0) {
                    $body.append('<tr><td colspan="4" class="text-center text-muted p-3">No data found</td></tr>');
                    return;
                }

                d.students.forEach((s, idx) => {
                    const progress = (s.completed_count / d.total_lessons * 100) || 0;
                    const row_id = `details-${idx}`;

                    // Handle null names
                    const displayName = s.student_name && s.student_name !== 'null' ? s.student_name : s.student;

                    $body.append(`
                        <tr class="clickable-row" style="cursor:pointer" onclick="$('#${row_id}').toggle()">
                            <td><b>${displayName}</b> <br> <small class="text-muted">${s.student}</small></td>
                            <td>
                                <div class="progress" style="height:18px">
                                    <div class="progress-bar bg-success" style="width:${progress}%">${progress.toFixed(1)}%</div>
                                </div>
                            </td>
                            <td>${s.completed_count} of ${d.total_lessons} completed</td>
                            <td>${s.lesson_details[0]?.last_activity || '-'}</td>
                        </tr>
                        <tr id="${row_id}" style="display:none; background:#f9f9f9">
                            <td colspan="4" class="p-4">
                                <h6>All Lessons Progress</h6>
                                <table class="table table-sm table-bordered bg-white">
                                    <thead><tr><th>Lesson</th><th>Progress</th><th>Video Speed</th><th>Quiz Attempts</th><th>Quiz Score</th><th>Last Activity</th></tr></thead>
                                    <tbody>
                                        ${s.lesson_details.map(ld => `
                                            <tr>
                                                <td>${ld.lesson_title}</td>
                                                <td><span class="badge ${ld.is_completed ? 'bg-success' : 'bg-warning'}">${ld.is_completed ? '100%' : 'In Progress'}</span></td>
                                                <td>${ld.video_speed}</td>
                                                <td>${ld.quiz_attempts}</td>
                                                <td>${ld.quiz_score} ${ld.quiz_passed ? ` 
<small class="text-success">✓ at attempt ${ld.quiz_passed}</small>` : ''}</td>
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

    // Real-time events
    const setup_realtime = (event_name) => {
        frappe.realtime.on(event_name, (data) => refresh());
    };
    setup_realtime("lesson_completion_update");
    setup_realtime("quiz_submission_update");
    setup_realtime("video_progress_update");

    refresh();
};
