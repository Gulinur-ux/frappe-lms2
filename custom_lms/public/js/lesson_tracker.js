/**
 * Lesson Tracker - LMS dars sahifalarida progress ni avtomatik track qiladi
 * Dars ochilganda Partially Complete, 10 soniyadan keyin avtomatik Complete bo'ladi
 * Barcha userlar uchun ishlaydi (enrollment bo'lishi kerak)
 */
(function () {
    'use strict';

    let tracked = false;
    let completed = false;
    let currentLesson = null;

    function isLessonPage() {
        // /lms/courses/ yoki /courses/ ikkala formatni qabul qiladi
        return window.location.pathname.includes('/courses/') &&
            window.location.pathname.includes('/learn/');
    }

    function getLessonInfo() {
        const path = window.location.pathname;
        // Format: /lms/courses/{course}/learn/{chapter-lesson} yoki /courses/{course}/learn/{chapter}/{lesson}
        let match = path.match(/\/courses\/([^\/]+)\/learn\/(\d+)-(\d+)/);
        if (match) {
            return { course: match[1], chapter: match[2], lessonIdx: match[3] };
        }
        // Yoki /courses/{course}/learn/{chapter}/{lesson} formati
        match = path.match(/\/courses\/([^\/]+)\/learn\/(\d+)\/(\d+)/);
        if (match) {
            return { course: match[1], chapter: match[2], lessonIdx: match[3] };
        }
        return null;
    }

    async function getCurrentLessonName(course, chapterIdx, lessonIdx) {
        return new Promise((resolve) => {
            // Avval chapterlarni olamiz
            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Chapter Reference',
                    filters: { parent: course },
                    fields: ['chapter', 'idx'],
                    order_by: 'idx asc'
                },
                async: true,
                callback: (r) => {
                    if (r && r.message && r.message.length > 0) {
                        const chapters = r.message;
                        const targetChapterIdx = parseInt(chapterIdx) - 1;

                        if (chapters[targetChapterIdx]) {
                            const chapterName = chapters[targetChapterIdx].chapter;

                            // Keyin shu chapterdagi darslarni olamiz
                            frappe.call({
                                method: 'frappe.client.get_list',
                                args: {
                                    doctype: 'Lesson Reference',
                                    filters: { parent: chapterName },
                                    fields: ['lesson', 'idx'],
                                    order_by: 'idx asc'
                                },
                                async: true,
                                callback: (r2) => {
                                    if (r2 && r2.message && r2.message.length > 0) {
                                        const targetLessonIdx = parseInt(lessonIdx) - 1;
                                        if (r2.message[targetLessonIdx]) {
                                            resolve(r2.message[targetLessonIdx].lesson);
                                        } else {
                                            resolve(null);
                                        }
                                    } else {
                                        resolve(null);
                                    }
                                }
                            });
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                }
            });
        });
    }

    function trackLessonView(lesson, course) {
        if (tracked) return;
        tracked = true;
        frappe.call({
            method: 'custom_lms.api.track_lesson_view',
            args: { lesson: lesson, course: course },
            async: true,
            callback: (r) => {
                if (r && r.message) {
                    console.log('Lesson tracker:', r.message);
                    if (r.message.status === 'ok') {
                        console.log('Dars ko\'rilmoqda:', lesson);
                    } else if (r.message.status === 'error') {
                        console.log('Xatolik:', r.message.message);
                    }
                }
            }
        });
    }

    function markLessonComplete(lesson, course) {
        if (completed) return;
        completed = true;
        frappe.call({
            method: 'custom_lms.api.mark_lesson_complete',
            args: { lesson: lesson, course: course },
            async: true,
            callback: (r) => {
                if (r && r.message && r.message.status === 'ok') {
                    console.log('Dars tugatildi:', lesson);
                    frappe.show_alert({ message: 'Dars tugatildi!', indicator: 'green' });
                }
            }
        });
    }

    function init() {
        if (!isLessonPage()) {
            console.log('Lesson tracker: Bu lesson sahifasi emas');
            return;
        }

        tracked = false;
        completed = false;

        const info = getLessonInfo();
        if (!info) {
            console.log('Lesson tracker: URL dan lesson info olishda xatolik');
            return;
        }

        console.log('Lesson tracker: Sahifa aniqlandi', info);

        setTimeout(async () => {
            const lessonName = await getCurrentLessonName(info.course, info.chapter, info.lessonIdx);

            if (lessonName) {
                currentLesson = lessonName;
                console.log('Lesson tracker: Lesson name topildi:', lessonName);

                // Darhol track qilish (Partially Complete)
                trackLessonView(lessonName, info.course);

                // 10 soniyadan keyin avtomatik Complete
                setTimeout(() => {
                    markLessonComplete(lessonName, info.course);
                }, 10000);

                // Video bo'lsa, tugaganda ham complete
                const video = document.querySelector('video');
                if (video) {
                    video.addEventListener('ended', () => {
                        markLessonComplete(lessonName, info.course);
                    });
                }

                // Sahifa oxirigacha scroll qilinganda ham complete
                window.addEventListener('scroll', () => {
                    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
                        markLessonComplete(lessonName, info.course);
                    }
                });
            } else {
                console.log('Lesson tracker: Lesson name topilmadi');
            }
        }, 2000);
    }

    // Sahifa yuklanganda
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }

    // SPA uchun - route o'zgarganda
    if (typeof frappe !== 'undefined' && frappe.router) {
        frappe.router.on('change', () => {
            setTimeout(init, 1000);
        });
    }

    // Vue router uchun
    window.addEventListener('popstate', () => {
        setTimeout(init, 1000);
    });
})();
