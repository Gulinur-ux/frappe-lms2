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
                <div class="col-md-4"><div class="p-3 bg-white border rounded"><h6>Total Students</h6><h2 id="stat-s">0</h2></div></div>
                <div class="col-md-4"><div class="p-3 bg-white border rounded"><h6>Total Courses</h6><h2 id="stat-c">0</h2></div></div>
                <div class="col-md-4"><div class="p-3 bg-white border rounded"><h6>Total Lessons</h6><h2 id="stat-l">0</h2></div></div>
            </div>
            <div class="bg-white border rounded">
                <table class="table table-hover m-0">
                    <thead class="bg-light">
                        <tr>
                            <th style="width:40%">Student</th>
                            <th>Enrolled Courses</th>
                            <th>Avg Engagement</th>
                            <th>Last Active</th>
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
        if (f.$input && f.$input[0] && f.$input[0].awesomplete) {
            f.$input[0].awesomplete.on('selectcomplete', () => refresh());
        }
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

        frappe.call({
            method: 'custom_lms.api.get_student_dashboard_data',
            args: filters,
            callback: (r) => {
                const d = r.message;
                if (!d) return;

                $('#stat-s').text(d.total_students || 0);
                $('#stat-c').text(d.total_courses || 0);
                $('#stat-l').text(d.total_lessons || 0);
                render_students_list(d.students || []);
            }
        });
    };

    const render_students_list = (students_data) => {
        const $body = $('#dash-body').empty();
        if (!students_data || students_data.length === 0) {
            $body.append('<tr><td colspan="4" class="text-center text-muted p-3">No data found</td></tr>');
            return;
        }

        // Group by student
        const student_map = {};
        students_data.forEach(s => {
            const student_id = s.student;
            if (!student_map[student_id]) {
                student_map[student_id] = {
                    id: student_id,
                    name: s.student_name && s.student_name !== 'null' ? s.student_name : s.student,
                    courses: [],
                    last_active: null,
                    total_engagement: 0,
                    engagement_count: 0
                };
            }
            student_map[student_id].courses.push(s);

            // Aggregates
            if (s.last_activity && s.last_activity !== 'Never') {
                // Simple string comparison might fail, but for now take latest seen string or just first
                student_map[student_id].last_active = s.last_activity;
            }
            if (s.avg_engagement) {
                student_map[student_id].total_engagement += s.avg_engagement;
                student_map[student_id].engagement_count++;
            }
        });

        // Render rows
        Object.values(student_map).forEach(s => {
            const avg_eng = s.engagement_count ? Math.round(s.total_engagement / s.engagement_count) : 0;

            let engColor = 'bg-secondary';
            if (avg_eng >= 70) engColor = 'bg-success';
            else if (avg_eng >= 40) engColor = 'bg-warning text-dark';
            else if (avg_eng > 0) engColor = 'bg-danger';

            const $row = $(`
                <tr class="clickable-row" style="cursor:pointer">
                    <td>
                        <div class="d-flex align-items-center">
                            <div class="avatar avatar-md mr-2" style="margin-right:10px">
                                <span class="avatar-frame" style="background-color: var(--primary-color); color: white;">
                                    ${frappe.get_abbr(s.name)}
                                </span>
                            </div>
                            <div>
                                <div class="font-weight-bold">${s.name}</div>
                                <div class="text-muted small">${s.id}</div>
                            </div>
                        </div>
                    </td>
                    <td><span class="badge badge-primary" style="font-size:12px">${s.courses.length} Courses</span></td>
                    <td>
                        ${avg_eng > 0 ? `<span class="badge ${engColor}">${avg_eng}</span>` : '<span class="text-muted">-</span>'}
                    </td>
                    <td>${s.last_active || 'Never'}</td>
                </tr>
            `);

            $row.click(() => show_student_courses(s));
            $body.append($row);
        });
    };

    const show_student_courses = (student_obj) => {
        const d = new frappe.ui.Dialog({
            title: `Courses: ${student_obj.name}`,
            size: 'large',
            fields: [
                { fieldtype: 'HTML', fieldname: 'courses_html' }
            ]
        });

        let html = `
            <table class="table table-bordered table-striped">
                <thead>
                    <tr>
                        <th>Course Name</th>
                        <th>Progress</th>
                        <th>Status</th>
                        <th>Engagement</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
        `;

        student_obj.courses.forEach((c, idx) => {
            const progress = c.progress_percent || 0;
            let engColor = 'bg-secondary';
            if (c.avg_engagement >= 70) engColor = 'bg-success';
            else if (c.avg_engagement >= 40) engColor = 'bg-warning text-dark';
            else if (c.avg_engagement > 0) engColor = 'bg-danger';

            html += `
                <tr>
                    <td><b>${c.course_name}</b></td>
                    <td>
                        <div class="progress" style="height:15px; width: 100px;">
                            <div class="progress-bar ${progress >= 100 ? 'bg-success' : 'bg-primary'}" style="width:${progress}%"></div>
                        </div>
                        <small>${progress}%</small>
                    </td>
                    <td>${c.completed_count}/${c.total_course_lessons} lessons</td>
                    <td><span class="badge ${engColor}">${c.avg_engagement || 0}</span></td>
                    <td>
                        <button class="btn btn-xs btn-default btn-view-details" data-idx="${idx}">
                            View Details
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table><div id="course-details-area" class="mt-4 border-top pt-3"></div>`;

        d.fields_dict.courses_html.$wrapper.html(html);

        // Bind clicks
        d.fields_dict.courses_html.$wrapper.find('.btn-view-details').on('click', function () {
            const idx = $(this).data('idx');
            const course_data = student_obj.courses[idx];

            // Render detailed view in the same modal below
            const $area = d.fields_dict.courses_html.$wrapper.find('#course-details-area');
            render_course_details($area, course_data);
        });

        d.show();
    };

    const render_course_details = ($sys_area, course_data) => {
        let html = `
            <h5>Details: ${course_data.course_name}</h5>
            <table class="table table-sm table-bordered bg-white">
                <thead>
                    <tr>
                        <th>Lesson</th>
                        <th>Status</th>
                        <th>Video Engagement</th>
                        <th>Quiz</th>
                        <th>Activity</th>
                    </tr>
                </thead>
                <tbody>
        `;

        course_data.lesson_details.forEach(ld => {
            // Engagement color for lesson
            let lEngColor = 'bg-secondary';
            if (ld.engagement_score >= 70) lEngColor = 'bg-success';
            else if (ld.engagement_score >= 40) lEngColor = 'bg-warning text-dark';
            else if (ld.engagement_score > 0) lEngColor = 'bg-danger';

            // Format metrics
            const metrics = ld.engagement_score > 0 ?
                `<span class="badge ${lEngColor}" style="min-width:40px">${ld.engagement_score}</span>
                    <small class="ms-2 text-muted">
                    Watch: <b>${ld.watch_percentage}</b> | Seeks: <b>${ld.seek_count}</b>
                    </small>` :
                `<span class="text-muted small">No data</span>`;

            html += `
                <tr>
                    <td>${ld.lesson_title}</td>
                    <td><span class="badge ${ld.is_completed ? 'bg-success' : 'bg-warning'}">${ld.is_completed ? 'Completed' : 'Pending'}</span></td>
                    <td>${metrics}</td>
                    <td>${ld.quiz_score} (${ld.quiz_attempts} att)</td>
                    <td>${ld.last_activity}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        $sys_area.html(html);

        // Scroll to details
        $sys_area[0].scrollIntoView({ behavior: 'smooth' });
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
    setup_realtime("update_lesson_progress");

    frappe.realtime.on('connect', () => {
        console.log("Real-time connected!");
    });

    refresh();
};
