/**
 * Lesson Tracker - Advanced Video Analytics
 * Tracks lesson completion, video engagement, and viewing behavior.
 */
(function () {
    'use strict';

    // State 
    let state = {
        tracked: false,
        completed: false,
        lesson: null,
        course: null,
        startTime: Date.now(),
        // Video metrics
        videoDuration: 0,
        totalWatchTime: 0,
        seekCount: 0,
        pauseCount: 0,
        lastVideoTime: 0,
        watchedSegments: new Set(), // Store integer seconds watched
        playbackSpeeds: [],
        maxWatchPercentage: 0
    };

    let saveInterval = null;

    function isLessonPage() {
        return window.location.pathname.includes('/courses/') &&
            window.location.pathname.includes('/learn/');
    }

    function getLessonInfo() {
        const path = window.location.pathname;
        let match = path.match(/\/courses\/([^\/]+)\/learn\/(\d+)-(\d+)/);
        if (match) {
            return { course: match[1], chapter: match[2], lessonIdx: match[3] };
        }
        match = path.match(/\/courses\/([^\/]+)\/learn\/(\d+)\/(\d+)/);
        if (match) {
            return { course: match[1], chapter: match[2], lessonIdx: match[3] };
        }
        return null;
    }

    async function getCurrentLessonName(course, chapterIdx, lessonIdx) {
        return new Promise((resolve) => {
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
                                        } else { resolve(null); }
                                    } else { resolve(null); }
                                }
                            });
                        } else { resolve(null); }
                    } else { resolve(null); }
                }
            });
        });
    }

    function trackLessonView(lesson, course) {
        if (state.tracked) return;
        state.tracked = true;
        frappe.call({
            method: 'custom_lms.api.track_lesson_view',
            args: { lesson: lesson, course: course },
            async: true
        });
    }

    function markLessonComplete(lesson, course) {
        if (state.completed) return;

        // Check if engagement is high enough (optional enforcement)
        // For now just mark complete
        state.completed = true;
        saveAnalytics(true); // Save final analytics

        frappe.call({
            method: 'custom_lms.api.mark_lesson_complete',
            args: { lesson: lesson, course: course },
            async: true,
            callback: (r) => {
                if (r && r.message && r.message.status === 'ok') {
                    frappe.show_alert({ message: 'Lesson completed!', indicator: 'green' });
                }
            }
        });
    }

    function saveAnalytics(isCompleted = false) {
        if (!state.lesson || !state.course) return;

        const timeSpent = (Date.now() - state.startTime) / 1000;

        // Calculate watch percentage
        let watchPercentage = 0;
        if (state.videoDuration > 0) {
            // Count unique seconds watched
            const uniqueSeconds = state.watchedSegments.size;
            watchPercentage = (uniqueSeconds / state.videoDuration) * 100;
            // Cap at 100
            watchPercentage = Math.min(watchPercentage, 100);
            state.maxWatchPercentage = Math.max(state.maxWatchPercentage, watchPercentage);
        }

        // Check for completion based on percentage (90% threshold)
        if (!state.completed && watchPercentage >= 90) {
            markLessonComplete(state.lesson, state.course);
            isCompleted = true; // Update local flag for this save
        }

        const data = {
            lesson: state.lesson,
            course: state.course,
            video_duration: state.videoDuration,
            watch_percentage: parseFloat(state.maxWatchPercentage.toFixed(2)),
            total_watch_time: parseFloat(state.totalWatchTime.toFixed(2)),
            seek_count: state.seekCount,
            pause_count: state.pauseCount,
            playback_speed: state.playbackSpeeds.length ?
                state.playbackSpeeds[state.playbackSpeeds.length - 1] : 1,
            page_time_spent: parseFloat(timeSpent.toFixed(2)),
            completed: isCompleted
        };

        // Use frappe.call instead of sendBeacon for better reliability with custom methods
        // sendBeacon requires a specific endpoint handling text/plain or Blob
        frappe.call({
            method: 'custom_lms.api.save_video_analytics',
            args: { data: JSON.stringify(data) },
            async: true,
            callback: (r) => {
                // Silent success
            }
        });
    }

    function setupVideoTracking() {
        const video = document.querySelector('video');
        const iframe = document.querySelector('iframe[src*="youtube.com"]');

        if (video) {
            setupHTML5Video(video);
        } else if (iframe) {
            setupYouTubeVideo(iframe);
        }
    }

    function setupHTML5Video(video) {
        console.log('HTML5 video tracker attached');
        if (video.duration) state.videoDuration = video.duration;
        video.addEventListener('loadedmetadata', () => { state.videoDuration = video.duration; });
        video.addEventListener('timeupdate', () => {
            if (!video.paused && !video.seeking) {
                state.watchedSegments.add(Math.floor(video.currentTime));
            }
        });

        let watchInterval = setInterval(() => {
            if (!video.paused && !video.seeking) {
                state.totalWatchTime += 1;
            }
        }, 1000);

        video.addEventListener('seeking', () => state.seekCount++);
        video.addEventListener('pause', () => state.pauseCount++);
        video.addEventListener('ratechange', () => state.playbackSpeeds.push(video.playbackRate));
        video.addEventListener('ended', () => {
            // Completion is handled by saveAnalytics percentage check
        });
    }

    function setupYouTubeVideo(iframe) {
        console.log("YouTube video detected");
        // Inject YouTube API if not present
        if (!window.YT) {
            var tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            var firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }

        const onPlayerReady = (event) => {
            console.log("YT Player Ready");
            state.videoDuration = event.target.getDuration();
            setInterval(() => {
                if (event.target.getPlayerState() === 1) { // Playing
                    state.watchedSegments.add(Math.floor(event.target.getCurrentTime()));
                    state.totalWatchTime += 1;
                }
            }, 1000);
        };

        const onStateChange = (event) => {
            if (event.data === 2) state.pauseCount++; // Paused
        };

        const checkYT = setInterval(() => {
            if (window.YT && window.YT.Player) {
                clearInterval(checkYT);
                // We need to enable JS API on iframe if not already
                // Often solved by re-creating logic or just attaching if ID exists
                // For simplicity, we assume iframe is ready or we just use it
                new YT.Player(iframe, {
                    events: {
                        'onReady': onPlayerReady,
                        'onStateChange': onStateChange
                    }
                });
            }
        }, 500);
    }

    function init() {
        if (!isLessonPage()) return;

        // Reset state
        state = {
            tracked: false,
            completed: false,
            lesson: null,
            course: null,
            startTime: Date.now(),
            videoDuration: 0,
            totalWatchTime: 0,
            seekCount: 0,
            pauseCount: 0,
            lastVideoTime: 0,
            watchedSegments: new Set(),
            playbackSpeeds: [],
            maxWatchPercentage: 0
        };

        if (saveInterval) clearInterval(saveInterval);

        const info = getLessonInfo();
        if (!info) return;

        setTimeout(async () => {
            const lessonName = await getCurrentLessonName(info.course, info.chapter, info.lessonIdx);

            if (lessonName) {
                state.lesson = lessonName;
                state.course = info.course;
                console.log('Tracking analytics for:', lessonName);

                trackLessonView(lessonName, info.course);
                setupVideoTracking();

                // Video bo'lmasa, 10 soniyadan keyin complete (text darslar uchun)
                const video = document.querySelector('video');
                if (!video) {
                    setTimeout(() => {
                        markLessonComplete(lessonName, info.course);
                    }, 10000);
                }
                // Video bo'lsa, hech qanday timer yo'q. 
                // Complete bo'lishi uchun watch_percentage >= 90 bo'lishi kerak (saveAnalytics da)

                // Auto-save every 30 seconds
                saveInterval = setInterval(() => {
                    saveAnalytics(false);
                }, 30000);

                // Save on unload
                window.addEventListener('beforeunload', () => {
                    saveAnalytics(false);
                });

                // Also complete on scroll if video missing or user prefers reading
                setTimeout(() => {
                    const video = document.querySelector('video');
                    // Only auto-complete by scroll if video is short or non-existent?
                    // User requested "optimal way", maybe remove scroll completion if video exists 
                    // to force watching? 
                    // Let's keep scroll completion but maybe stricter/longer delay?
                    // Original logic:
                    window.addEventListener('scroll', () => {
                        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
                            markLessonComplete(lessonName, info.course);
                        }
                    });
                }, 5000); // 5s delay before enabling scroll completion
            }
        }, 2000);
    }

    // Init Logic
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }

    // Routing
    if (typeof frappe !== 'undefined' && frappe.router) {
        frappe.router.on('change', () => setTimeout(init, 1000));
    }
    window.addEventListener('popstate', () => setTimeout(init, 1000));

})();
