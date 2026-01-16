$(document).on('app_ready', function() {
    if (window.location.pathname.includes('/lms/lesson/')) {
        const video = document.querySelector('video');
        if (!video) return;

        const save = (done = 0) => {
            frappe.call({
                method: 'custom_lms.api.update_video_progress',
                args: {
                    lesson: cur_page.page.name,
                    video_url: video.currentSrc,
                    last_time: video.currentTime,
                    playback_speed: video.playbackRate,
                    is_completed: done
                }
            });
        };

        video.addEventListener('timeupdate', () => {
            if (Math.floor(video.currentTime) % 10 === 0) save();
        });
        video.addEventListener('ratechange', () => save());
        video.addEventListener('ended', () => save(1));
    }
});
