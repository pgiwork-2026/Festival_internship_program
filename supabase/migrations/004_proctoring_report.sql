-- Proctoring v2 (3 warnings, 4th violation auto-submits) + shareable report links.
alter table assessment_attempts drop constraint if exists assessment_attempts_status_check;
alter table assessment_attempts add constraint assessment_attempts_status_check check (status in ('in_progress','submitted','timed_out','auto_submitted'));
alter table proctoring_violations drop constraint if exists proctoring_violations_type_check;
alter table proctoring_violations add constraint proctoring_violations_type_check check (type in ('multiple_faces','no_face','looking_away','phone_detected','camera_unavailable','tab_switch','face_mismatch','fullscreen_exit','copy_paste'));
alter table proctoring_violations add column if not exists counted boolean not null default true; -- false = duplicate inside the 5 s window
alter table assessment_attempts add column if not exists share_token text unique;              -- created only when the student clicks Share
