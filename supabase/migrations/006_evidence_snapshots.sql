-- Run after 005, BEFORE deploying the new server code.
-- Adds the advisory event types (looking_down, noise_detected) and a column for the small evidence snapshot kept with a flagged event.
alter table proctoring_violations drop constraint if exists proctoring_violations_type_check;
alter table proctoring_violations add constraint proctoring_violations_type_check check (type in ('multiple_faces','no_face','looking_away','phone_detected','camera_unavailable','tab_switch','face_mismatch','fullscreen_exit','copy_paste','blocked_shortcut','looking_down','noise_detected'));
alter table proctoring_violations add column if not exists snapshot text; -- small base64 JPEG (max 8 per attempt); readable only by admins via the server (RLS policy v_admin)
