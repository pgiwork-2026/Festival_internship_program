-- 009: Winter Internship & Training Program batch and course tracks setup
-- Activates the Winter cohort and seeds technical & non-technical curriculum courses.

-- 1. Ensure batches table has the Winter cohort marked active
update batches set status = 'completed' where status = 'active';

insert into batches(slug, name, status, starts_on, ends_on, description)
values (
  'winter-2026',
  'Winter Internship 2026',
  'active',
  '2026-12-01',
  '2026-12-15',
  'Winter Internship and Training Program at Plant Green Inertia Pvt. Ltd. (Online & Offline Cohorts)'
)
on conflict (slug) do update set
  status = 'active',
  starts_on = '2026-12-01',
  ends_on = '2026-12-15',
  name = 'Winter Internship 2026',
  updated_at = now();

-- 2. Add or update winter course tracks
insert into courses(title, description, duration, skills, benefits)
values
  (
    'Web Development & Cloud Deployment',
    'Learn how modern responsive websites and web applications are structured, styled, made interactive, and published live.',
    '10 Days (30 Hours)',
    '{HTML5,CSS3 Flexbox & Grid,JavaScript ES6+,DOM Manipulation,Git & GitHub,GitHub Pages Deployment}',
    '{Live Project Hosting,Portfolio Review,Code Mentorship}'
  ),
  (
    'Mobile App Development',
    'Master visual mobile interface architecture, user interaction logic, cloud data storage, sensor APIs, and Android APK deployment.',
    '10 Days (30 Hours)',
    '{Mobile UI/UX Design,MIT App Inventor,App Logic & Event Blocks,CloudDB Storage,Device Sensors,Android APK Packaging}',
    '{Real-World App Build,Mobile Testing,Deployment Guide}'
  ),
  (
    'Digital Operations & Agile Management',
    'Industry-standard agile lifecycle, sprint planning, project workflow management, digital process optimization, and team collaboration.',
    '10 Days (30 Hours)',
    '{Agile & Scrum,Sprint Planning,Jira & Trello Workflows,Process Quality Assurance,Cross-Functional Communication}',
    '{Industry Case Studies,Workflow Templates,Managerial Review}'
  ),
  (
    'Business Analysis & Tech Communication',
    'Translate strategic business goals into software requirements documentation, wireframes, data insights, and client presentations.',
    '10 Days (30 Hours)',
    '{BRD & FRD Authoring,Process Flowcharts,Wireframing,Data Analysis with Excel,Executive Presentation}',
    '{Real-World Case Study,Requirements Dossier,Executive Feedback}'
  )
on conflict do nothing;
