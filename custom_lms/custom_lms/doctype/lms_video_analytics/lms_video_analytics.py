# Copyright (c) 2026, Gulinur and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LMSVideoAnalytics(Document):
    def before_save(self):
        # Calculate engagement score
        self.calculate_engagement_score()
    
    def calculate_engagement_score(self):
        """
        Engagement score formula:
        - Watch percentage (40%): Higher is better
        - Seek penalty (20%): More seeks = lower score
        - Speed penalty (20%): Speed > 1.5x = lower score
        - Time ratio (20%): Watch time vs video duration
        """
        score = 0
        
        # Watch percentage contribution (0-40 points)
        watch_pct = self.watch_percentage or 0
        score += (watch_pct / 100) * 40
        
        # Seek penalty (0-20 points, fewer seeks = more points)
        seek_count = self.seek_count or 0
        if seek_count == 0:
            score += 20
        elif seek_count <= 3:
            score += 15
        elif seek_count <= 5:
            score += 10
        elif seek_count <= 10:
            score += 5
        # else: 0 points
        
        # Speed penalty (0-20 points)
        speed = self.playback_speed or 1
        if speed <= 1.25:
            score += 20
        elif speed <= 1.5:
            score += 15
        elif speed <= 1.75:
            score += 10
        elif speed <= 2:
            score += 5
        # else: 0 points
        
        # Time ratio (0-20 points)
        if self.video_duration and self.video_duration > 0:
            watch_time = self.total_watch_time or 0
            ratio = min(watch_time / self.video_duration, 1)
            score += ratio * 20
        
        self.engagement_score = round(score, 1)
