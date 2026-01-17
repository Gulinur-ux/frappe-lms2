/**
 * Lesson Tracker - Advanced Video Analytics
 * Tracks lesson completion, video engagement, and viewing behavior.
 * Supports HTML5 Video and YouTube Embeds with Auto-API Injection.
 */
(function () {
    'use strict';

    // State 
    // State 
    let state = {
        tracked: false,
        completed: false,
        lesson: null,
        course: null,
        startTime: Date.now(),
        // Video metrics
        videoDuration: 0,
        accumulatedTime: 0, // NEW: Real watched time
        pastTime: 0, // NEW: Time watched before this session
        totalWatchTime: 0,  // Duplicate field for compatibility or removal? Let's use accumulatedTime as the source of truth.
        seekCount: 0,
        pauseCount: 0,
        lastVideoTime: 0,
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
            async: true,
            callback: (r) => {
                if (r && r.message) {
                    // Init state from backend
                    state.pastTime = r.message.past_accumulated_time || 0;
                    if (r.message.today_accumulated_time) {
                        state.accumulatedTime = r.message.today_accumulated_time;
                    }
                    if (r.message.video_duration && state.videoDuration === 0) {
                        state.videoDuration = r.message.video_duration;
                    }
                    console.log(`Resumed tracking. Past: ${state.pastTime}s, Today: ${state.accumulatedTime}s, Duration: ${state.videoDuration}s`);
                }
            }
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

    function updateProgress() {
        if (state.completed) return;

        // Safe duration check
        if (!state.videoDuration || state.videoDuration <= 0) {
            // console.log("Waiting for duration...");
            return;
        }

        // Strict Calculation: Accumulated Time / Duration
        // Use MAIN state which tracks persistence
        const totalEffectiveTime = state.accumulatedTime + state.pastTime;
        const percent = (totalEffectiveTime / state.videoDuration) * 100;

        console.log(`Debug: Current: ${state.accumulatedTime.toFixed(1)}s, Past: ${state.pastTime.toFixed(1)}s, Total: ${totalEffectiveTime.toFixed(1)}s / ${state.videoDuration.toFixed(1)}s (${percent.toFixed(1)}%)`);

        if (percent >= 90) { // 90% threshold
            state.completed = true; // Sync main state
            console.log("Lesson Completed (90% watched)");

            // Show alert to user
            frappe.show_alert({ message: 'Lesson Completed! (90% watched)', indicator: 'green' });

            markLessonComplete(state.lesson, state.course);
            saveAnalytics(true);
        }
    }

    function saveAnalytics(isCompleted = false) {
        if (!state.lesson || !state.course) return;

        const timeSpent = (Date.now() - state.startTime) / 1000;

        // Calculate watch percentage using accumulatedTime (Anti-Cheat)
        let watchPercentage = 0;
        let totalEffectiveTime = state.accumulatedTime + state.pastTime;

        // Sync duration if needed
        if (!state.videoDuration && state.accumulatedTime > 0) {
            // Fallback if videoDuration is 0 but we have stats
            state.videoDuration = (totalEffectiveTime * 100) / (state.maxWatchPercentage || 1);
        }

        if (state.videoDuration > 0) {
            watchPercentage = (totalEffectiveTime / state.videoDuration) * 100;
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
            total_watch_time: parseFloat(state.accumulatedTime.toFixed(2)),
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
        state.lastVideoTime = video.currentTime;

        video.addEventListener('loadedmetadata', () => { state.videoDuration = video.duration; });

        video.addEventListener('timeupdate', () => {
            if (!video.paused && !video.seeking) {
                const currentTime = video.currentTime;
                const delta = currentTime - state.lastVideoTime;

                // Anti-Cheat: Only accumulate if delta is small (natural playback)
                // 1.5s threshold allows for minor lag but prevents skipping
                if (delta > 0 && delta < 1.5) {
                    state.accumulatedTime += delta;
                }
                state.lastVideoTime = currentTime;

                // Trigger check
                videoState.accumulatedTime = state.accumulatedTime; // Sync for local logic if needed
                updateProgress();
            }
        });

        video.addEventListener('seeking', () => {
            state.seekCount++;
            // Reset lastVideoTime to new position so we don't count the jump
            state.lastVideoTime = video.currentTime;
        });

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
                            state.lastVideoTime = event.target.getCurrentTime();

                            setInterval(() => {
                                if (event.target.getPlayerState() === 1) { // Playing
                                    const currentTime = event.target.getCurrentTime();
                                    const delta = currentTime - state.lastVideoTime;

                                    // Anti-Cheat: YouTube poll is 1s. Allow 2.0s for lag.
                                    if (delta > 0 && delta < 2.0) {
                                        state.accumulatedTime += delta;
                                        updateProgress();
                                    } else if (delta > 2.0) {
                                        // Seek detected
                                        state.seekCount++;
                                    }
                                    state.lastVideoTime = currentTime;
                                } else {
                                    // Even if paused, update lastVideoTime so resuming doesn't count as jump
                                    state.lastVideoTime = event.target.getCurrentTime();
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
            accumulatedTime: 0,
            totalWatchTime: 0,
            seekCount: 0,
            pauseCount: 0,
            lastVideoTime: 0,
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
