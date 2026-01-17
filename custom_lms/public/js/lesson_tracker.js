/**
 * Lesson Tracker - Advanced Video Analytics
 * Tracks lesson completion, video engagement, and viewing behavior.
 * Supports HTML5 Video and YouTube Embeds with Auto-API Injection.
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
    let videoCheckInterval = null;

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
        state.completed = true;
        saveAnalytics(true);
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
            const uniqueSeconds = state.watchedSegments.size;
            watchPercentage = (uniqueSeconds / state.videoDuration) * 100;
            watchPercentage = Math.min(watchPercentage, 100);
            state.maxWatchPercentage = Math.max(state.maxWatchPercentage, watchPercentage);
        }

        // Strict Completion: If video exists, require 90%
        if (!state.completed && state.videoDuration > 0) {
            if (watchPercentage >= 90) {
                markLessonComplete(state.lesson, state.course);
                isCompleted = true;
            }
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

        frappe.call({
            method: 'custom_lms.api.save_video_analytics',
            args: { data: JSON.stringify(data) },
            async: true,
            callback: (r) => { }
        });
    }

    function setupVideoTracking() {
        let attempts = 0;
        const maxAttempts = 6; // 3 seconds check (500ms * 6)

        // Ensure YT API is loaded
        if (!window.YT) {
            var tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            var firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }

        // Visual indicator that tracking is starting
        console.log("Starting video detection...");

        videoCheckInterval = setInterval(() => {
            const video = document.querySelector('video');
            const iframe = document.querySelector('iframe[src*="youtube.com"]');

            if (video) {
                clearInterval(videoCheckInterval);
                setupHTML5Video(video);
                return;
            } else if (iframe) {
                clearInterval(videoCheckInterval);
                setupYouTubeVideo(iframe);
                return;
            }

            attempts++;
            if (attempts >= maxAttempts) {
                clearInterval(videoCheckInterval);
                console.log("No video found, switching to Text/Image Lesson mode");

                // 1. Timer based completion (5 seconds)
                setTimeout(() => {
                    markLessonComplete(state.lesson, state.course);
                }, 5000);

                // 2. Scroll based completion (Immediate if scrolled to bottom)
                window.addEventListener('scroll', () => {
                    if (!state.completed && (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 50) {
                        markLessonComplete(state.lesson, state.course);
                    }
                });
            }
        }, 500);
    }

    function setupHTML5Video(video) {
        console.log('HTML5 video detected');
        if (video.duration) state.videoDuration = video.duration;
        video.addEventListener('loadedmetadata', () => { state.videoDuration = video.duration; });
        video.addEventListener('timeupdate', () => {
            if (!video.paused && !video.seeking) {
                state.watchedSegments.add(Math.floor(video.currentTime));
            }
        });

        setInterval(() => {
            if (!video.paused && !video.seeking) {
                state.totalWatchTime += 1;
            }
        }, 1000);

        video.addEventListener('seeking', () => state.seekCount++);
        video.addEventListener('pause', () => state.pauseCount++);
        video.addEventListener('ratechange', () => state.playbackSpeeds.push(video.playbackRate));
    }

    function setupYouTubeVideo(iframe) {
        console.log("YouTube video detected");

        // Auto-fix: Add enablejsapi=1 if missing
        let src = iframe.getAttribute('src');
        if (src && !src.includes('data-yt-fixed')) {
            if (src && !src.includes('enablejsapi=1')) {
                console.log("Injecting enablejsapi=1 to iframe");
                const separator = src.includes('?') ? '&' : '?';
                iframe.src = src + separator + 'enablejsapi=1';
                iframe.setAttribute('data-yt-fixed', 'true');
                // Wait for reload
                iframe.onload = () => initYTPlayer(iframe);
            } else {
                initYTPlayer(iframe);
            }
        } else {
            initYTPlayer(iframe);
        }
    }

    function initYTPlayer(iframe) {
        const checkYT = setInterval(() => {
            if (window.YT && window.YT.Player) {
                clearInterval(checkYT);
                new YT.Player(iframe, {
                    events: {
                        'onReady': (event) => {
                            console.log("YT Player Ready");
                            state.videoDuration = event.target.getDuration();
                            setInterval(() => {
                                if (event.target.getPlayerState() === 1) { // Playing
                                    state.watchedSegments.add(Math.floor(event.target.getCurrentTime()));
                                    state.totalWatchTime += 1;
                                }
                            }, 1000);
                        },
                        'onStateChange': (event) => {
                            if (event.data === 2) state.pauseCount++; // Paused
                        }
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
        if (videoCheckInterval) clearInterval(videoCheckInterval);

        const info = getLessonInfo();
        if (!info) return;

        setTimeout(async () => {
            const lessonName = await getCurrentLessonName(info.course, info.chapter, info.lessonIdx);

            if (lessonName) {
                state.lesson = lessonName;
                state.course = info.course;
                console.log('Tracking analytics for:', lessonName);

                trackLessonView(lessonName, info.course);
                setupVideoTracking(); // Starts looking for video or fallback

                // Auto-save every 30 seconds
                saveInterval = setInterval(() => {
                    saveAnalytics(false);
                }, 30000);

                // Save on unload
                window.addEventListener('beforeunload', () => {
                    saveAnalytics(false);
                });
            }
        }, 1000);
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
