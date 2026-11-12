import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { sendPasswordResetEmail } from './email.js';
import { buildProjectReportPDF } from './project_report.js';
import { buildCertificatePDF } from './certificate.js';
import { SYLLABUS_TRACKS, normalizeLoginPassword, parseDobCredentials, sharedSupportTickets } from './logic.js';

// In-memory fallback stores for offline testing and development
const localPasswordResets = new Map();
const localAttendance = new Map();
const localAssignments = new Map();
const localProjects = new Map();

export function registerStudentRoutes(app, { db, auth, wrap, fail, localApplications, onAuth }) {

  // Resolve Candidate UID, Student ID, or Email to user record
  async function resolveUserByIdentifier(identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) throw fail(400, 'Candidate UID, Student ID, or Email is required');

    if (raw.includes('@')) {
      return { email: raw.toLowerCase() };
    }

    const upperRaw = raw.toUpperCase();

    // Check in-memory application store (used when internship_applications table isn't migrated yet)
    if (localApplications) {
      const direct = localApplications.get(upperRaw);
      if (direct?.email) {
        return { email: direct.email, applicationId: direct.application_id || direct.applicationId };
      }
      for (const appRec of localApplications.values()) {
        const aid = String(appRec.application_id || appRec.applicationId || '').toUpperCase();
        if (aid === upperRaw && appRec.email) {
          return { email: appRec.email, applicationId: appRec.application_id || appRec.applicationId };
        }
      }
    }

    // Lookup by student_id in profiles
    try {
      const { data: prof } = await db.from('profiles')
        .select('id, student_id, full_name, phone')
        .ilike('student_id', raw)
        .maybeSingle();

      if (prof) {
        const { data: u } = await db.auth.admin.getUserById(prof.id);
        if (u?.user?.email) {
          return { email: u.user.email, profile: prof, studentId: prof.student_id };
        }
      }
    } catch {}

    // Lookup in enrollments or internship_applications
    try {
      const { data: enr } = await db.from('enrollments')
        .select('user_id, student_id')
        .ilike('student_id', raw)
        .maybeSingle();

      if (enr) {
        const { data: u } = await db.auth.admin.getUserById(enr.user_id);
        if (u?.user?.email) {
          return { email: u.user.email, studentId: enr.student_id };
        }
      }
    } catch {}

    try {
      const { data: appRec } = await db.from('internship_applications')
        .select('email, application_id')
        .ilike('application_id', raw)
        .maybeSingle();

      if (appRec?.email) {
        return { email: appRec.email, applicationId: appRec.application_id };
      }
    } catch {}

    // Fallback: look up Supabase Auth user_metadata.application_id (survives restarts & missing table)
    if (/^PGI-/i.test(upperRaw)) {
      try {
        const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const matchedUser = (uList?.users || []).find(
          u => String(u.user_metadata?.application_id || '').toUpperCase() === upperRaw
        );
        if (matchedUser?.email) {
          return { email: matchedUser.email, applicationId: matchedUser.user_metadata.application_id };
        }
      } catch {}
    }

    throw fail(404, `No candidate account found for UID "${raw}". Check your email receipt or click Find UID.`);
  }

  function makeAuthClient() {
    if (process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
      return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
    }
    return db;
  }

  // ===================================================================
  // 1. STUDENT LOGIN (Candidate UID / Student ID / Email + DOB or Password)
  // ===================================================================
  async function mintSessionViaSecondaryCredential(authClient, email, rawPassword, normalizedPassword) {
    try {
      const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const targetUser = (uList?.users || []).find(
        u => String(u.email || '').toLowerCase() === email.toLowerCase()
      );
      if (!targetUser) return null;

      const meta = targetUser.user_metadata || {};
      const keyMatch = Boolean(
        meta.portal_access_key &&
        (rawPassword === meta.portal_access_key || normalizedPassword === meta.portal_access_key)
      );

      let dobStr = meta.dob || null;
      if (!dobStr && !meta.password_customized) {
        try {
          const { data: appRec } = await db.from('internship_applications')
            .select('dob')
            .ilike('email', email)
            .limit(1)
            .maybeSingle();
          dobStr = appRec?.dob || null;
        } catch {}
      }

      const dobCreds = dobStr ? parseDobCredentials(dobStr) : null;
      const dobMatch = Boolean(
        !meta.password_customized &&
        dobCreds?.password &&
        normalizedPassword === dobCreds.password
      );

      if (!keyMatch && !dobMatch) return null;

      // If logging in with DOB after an earlier checkout overwrote password, restore DOB auth password seamlessly
      if (dobMatch && !meta.password_customized) {
        try {
          await db.auth.admin.updateUserById(targetUser.id, { password: dobCreds.password });
          const repaired = await authClient.auth.signInWithPassword({ email, password: dobCreds.password });
          if (!repaired.error && repaired.data?.session) return repaired;
        } catch {}
      }

      if (db.auth?.admin?.generateLink) {
        const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
          type: 'magiclink',
          email
        });
        const hashedToken = linkData?.properties?.hashed_token;
        if (!linkErr && hashedToken && authClient.auth?.verifyOtp) {
          const verified = await authClient.auth.verifyOtp({
            token_hash: hashedToken,
            type: 'magiclink'
          });
          if (!verified.error && verified.data?.session) return verified;
        }
      }
    } catch {}
    return null;
  }

  const handleStudentLogin = wrap(async (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      throw fail(400, 'Candidate UID / Email and Date of Birth password are required');
    }

    const { email, studentId, applicationId } = await resolveUserByIdentifier(identifier);
    const normalizedPassword = normalizeLoginPassword(password);
    const authClient = makeAuthClient();

    // Authenticate with isolated client so the singleton service-role db client keeps RLS bypass intact
    let authRes = null;
    try {
      authRes = await authClient.auth.signInWithPassword({ email, password: normalizedPassword });
      if ((authRes.error || !authRes.data?.session) && normalizedPassword !== password) {
        authRes = await authClient.auth.signInWithPassword({ email, password });
      }
    } catch (err) {
      throw fail(401, 'Authentication failed: ' + (err.message || 'Invalid credentials'));
    }

    if (authRes?.error || !authRes?.data?.session) {
      const secondaryRes = await mintSessionViaSecondaryCredential(authClient, email, password, normalizedPassword);
      if (secondaryRes?.data?.session) {
        authRes = secondaryRes;
      }
    }

    if (authRes.error || !authRes.data?.session) {
      throw fail(401, authRes.error?.message || 'Invalid Candidate UID/Email or Date of Birth password');
    }

    const session = authRes.data.session;
    const user = authRes.data.user;
    if (onAuth && session?.access_token && user) onAuth(session.access_token, user);

    // Fetch candidate profile and enrollment details
    let profile = null, enrollment = null;
    try {
      const [{ data: pData }, { data: eData }] = await Promise.all([
        db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        db.from('enrollments').select('*, courses(*)').eq('user_id', user.id).maybeSingle()
      ]);
      profile = pData;
      enrollment = eData;
    } catch {}

    const resolvedStudentId = studentId || profile?.student_id || enrollment?.student_id || null;
    const resolvedAppId = applicationId || user.user_metadata?.application_id || null;

    res.json({
      ok: true,
      token: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      student: {
        id: user.id,
        email: user.email,
        studentId: resolvedStudentId,
        applicationId: resolvedAppId,
        name: profile?.full_name || user.user_metadata?.full_name || 'Candidate',
        phone: profile?.phone || user.user_metadata?.phone || '',
        enrolled: !!enrollment
      }
    });
  });

  app.post('/api/student/login', handleStudentLogin);
  app.post('/api/auth/student-login', handleStudentLogin);

  // ===================================================================
  // 2. PASSWORD RECOVERY (FORGOT PASSWORD)
  // ===================================================================
  app.post('/api/student/forgot-password', wrap(async (req, res) => {
    const { identifier } = req.body || {};
    if (!identifier) throw fail(400, 'Student ID or Email is required');

    let resolved = null;
    try {
      resolved = await resolveUserByIdentifier(identifier);
    } catch (err) {
      // Security: do not leak whether account exists; return friendly message
      return res.json({
        ok: true,
        message: 'If an account exists with this identifier, password recovery instructions have been emailed.'
      });
    }

    const email = resolved.email;
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    try {
      await db.from('password_resets').insert({
        email,
        token,
        expires_at: expiresAt,
        used: false
      });
    } catch {}

    localPasswordResets.set(token, { email, token, expiresAt, used: false });

    const portalBase = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const resetUrl = `${portalBase}/student-login.html?token=${token}&email=${encodeURIComponent(email)}`;

    sendPasswordResetEmail({
      name: resolved.profile?.full_name || 'Candidate',
      studentId: resolved.studentId,
      email,
      resetUrl
    }).catch(err => console.error('[Password Reset Email Error]', err));

    res.json({
      ok: true,
      message: `Recovery instructions sent to ${email}. Check your inbox or spam folder.`,
      previewToken: process.env.NODE_ENV === 'test' ? token : undefined
    });
  }));

  // ===================================================================
  // 3. RESET PASSWORD CONFIRMATION
  // ===================================================================
  app.post('/api/student/reset-password', wrap(async (req, res) => {
    const { token, email, newPassword } = req.body || {};
    if (!token || !newPassword) throw fail(400, 'Reset token and new password are required');
    if (String(newPassword).length < 8) throw fail(400, 'Password must be at least 8 characters long');

    let record = null;
    try {
      const { data } = await db.from('password_resets')
        .select('*')
        .eq('token', token)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      record = data;
    } catch {}

    if (!record && localPasswordResets.has(token)) {
      const local = localPasswordResets.get(token);
      if (!local.used && new Date(local.expiresAt) > new Date()) record = local;
    }

    if (!record) throw fail(400, 'Invalid or expired password reset link. Please request a new one.');

    const targetEmail = record.email || email;

    // Update password in Supabase Auth
    let updated = false;
    try {
      // Find user id by email
      const { data: users } = await db.auth.admin.listUsers();
      const u = (users?.users || []).find(x => x.email?.toLowerCase() === targetEmail.toLowerCase());
      if (u) {
        await db.auth.admin.updateUserById(u.id, {
          password: newPassword,
          user_metadata: { ...(u.user_metadata || {}), password_customized: true }
        });
        updated = true;
      }
    } catch (err) {
      console.warn('[Admin Update Password Error]', err.message);
    }

    // Mark token as used
    try {
      await db.from('password_resets').update({ used: true }).eq('token', token);
    } catch {}
    if (localPasswordResets.has(token)) localPasswordResets.get(token).used = true;

    res.json({
      ok: true,
      message: 'Your password has been successfully updated. You may now sign in with your new credentials.'
    });
  }));

  // ===================================================================
  // 4. PASSWORD CHANGE (AUTHENTICATED STUDENT)
  // ===================================================================
  app.post('/api/student/change-password', auth, wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) throw fail(400, 'Current password and new password are required');
    if (String(newPassword).length < 8) throw fail(400, 'New password must be at least 8 characters');

    // Verify current password via isolated client so singleton db retains service_role
    const { error: signInErr } = await makeAuthClient().auth.signInWithPassword({
      email: req.user.email,
      password: currentPassword
    });
    if (signInErr) throw fail(401, 'Current password is incorrect');

    // Update to new password and mark password as customized
    const existingMeta = req.user.user_metadata || {};
    await db.auth.admin.updateUserById(req.user.id, {
      password: newPassword,
      user_metadata: { ...existingMeta, password_customized: true }
    });

    res.json({ ok: true, message: 'Password changed successfully.' });
  }));

  // Shared helper to gather authoritative student enrollment, application, batch, and attendance data
  async function loadStudentContext(req) {
    const u = req.user.id;
    let profile = null, enrollment = null, appRecord = null, batch = null, assignedMentor = null, attempt = null, cert = null;

    try {
      const [{ data: pData }, { data: eData }, { data: aData }, { data: attData }] = await Promise.all([
        db.from('profiles').select('*').eq('id', u).maybeSingle(),
        db.from('enrollments').select('*, courses(*)').eq('user_id', u).order('enrolled_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('internship_applications').select('*').eq('email', req.user.email).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('assessment_attempts').select('score_percent,correct_count,total_questions,submitted_at,status').eq('user_id', u).neq('status', 'in_progress').order('submitted_at', { ascending: false }).limit(1).maybeSingle()
      ]);
      profile = pData;
      enrollment = eData;
      appRecord = aData;
      attempt = attData;

      const batchId = appRecord?.assigned_batch_id || enrollment?.batch_id;
      if (batchId) {
        const { data: bData } = await db.from('batches').select('*').eq('id', batchId).maybeSingle();
        batch = bData;
      } else {
        const { data: activeB } = await db.from('batches').select('*').eq('status', 'active').limit(1).maybeSingle();
        batch = activeB;
      }

      if (appRecord?.assigned_mentor_id) {
        const { data: mData } = await db.from('mentors').select('id,name,title,domain,email,bio').eq('id', appRecord.assigned_mentor_id).maybeSingle();
        assignedMentor = mData;
      }
    } catch {}

    const studentId = enrollment?.student_id || profile?.student_id || (appRecord?.application_id ? appRecord.application_id.replace('PGI-W26-', 'PGI-S26-') : '—');
    const mode = appRecord?.mode || 'Online';

    let attRecords = [];
    if (studentId && studentId !== '—') {
      try {
        const [{ data: attRows }, { data: certRow }] = await Promise.all([
          db.from('student_attendance').select('*').eq('student_id', studentId).order('date', { ascending: true }),
          db.from('certificates').select('*').eq('student_id', studentId).maybeSingle()
        ]);
        if (attRows && attRows.length) attRecords = attRows;
        cert = certRow;
      } catch {}
    }

    const presentDays = attRecords.filter(r => r.status === 'present').length;
    const absentDays = attRecords.filter(r => r.status === 'absent').length;
    const completedHours = attRecords
      .filter(r => r.status === 'present')
      .reduce((acc, r) => acc + Number(r.hours_logged || 0), 0);
    const totalMarked = presentDays + absentDays;
    const attendancePct = totalMarked ? Math.round((presentDays / totalMarked) * 100) : null;

    return {
      u, profile, enrollment, appRecord, batch, assignedMentor, attempt, cert,
      studentId, mode, attRecords, presentDays, absentDays, completedHours, attendancePct
    };
  }

  // ===================================================================
  // 5. STUDENT DASHBOARD TELEMETRY (Authoritative DB Data Only)
  // ===================================================================
  app.get('/api/student/dashboard', auth, wrap(async (req, res) => {
    const ctx = await loadStudentContext(req);
    const {
      u, profile, enrollment, appRecord, batch, assignedMentor, attempt, cert,
      studentId, mode, attRecords, presentDays, absentDays, completedHours, attendancePct
    } = ctx;

    const course = enrollment?.courses || {
      title: appRecord?.domain_name || 'Not Assigned',
      duration: '30 Hours',
      domain_type: appRecord?.domain_type || 'Technical',
      access_url: null
    };

    const paidPaise = enrollment ? Number(enrollment.amount_paise ?? 99900) : null;
    const fmtAmountLabel = paise => {
      if (paise === null || paise === undefined) return 'Unpaid';
      const val = paise / 100;
      return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
    };
    const paymentStatusText = enrollment
      ? `Paid (${fmtAmountLabel(paidPaise)} Verified)`
      : 'Pending Payment';

    const submissionsList = await loadStudentSubmissions(u, ctx);
    const assignmentsDone = submissionsList.filter(s => s.status === 'submitted' || s.status === 'reviewed').length;
    const capstoneTask = submissionsList.find(s => s.id === 'capstone');
    const projectStatusLabel = capstoneTask?.status === 'reviewed'
      ? 'Reviewed'
      : (capstoneTask?.status === 'submitted'
        ? 'Submitted'
        : (capstoneTask?.status === 'draft' ? 'Draft Saved' : 'Pending'));

    const defaultTiming = batch?.timings
      || (mode === 'Offline' ? '9:00 AM – 6:00 PM IST' : '4:00 PM – 6:00 PM IST');

    res.json({
      student: {
        id: u,
        studentId,
        applicationId: appRecord?.application_id || req.user.user_metadata?.application_id || null,
        email: req.user.email,
        name: profile?.full_name || appRecord?.full_name || req.user.user_metadata?.full_name || 'Student',
        phone: profile?.phone || appRecord?.mobile || '',
        college: appRecord?.college || '',
        department: appRecord?.department || '',
        passedOutYear: appRecord?.passed_out_year || '',
        domainType: appRecord?.domain_type || 'Technical',
        domainName: course.title,
        mode,
        internshipPeriod: appRecord?.internship_period || '',
        timing: defaultTiming,
        batchName: batch?.name || 'Winter Cohort 2026',
        batchDates: (batch?.starts_on && batch?.ends_on) ? `${batch.starts_on} to ${batch.ends_on}` : null,
        courseAccessUrl: course.access_url || null,
        address: appRecord?.address || '',
        mentor: assignedMentor
          ? `${assignedMentor.name}${assignedMentor.title ? `, ${assignedMentor.title}` : ''}`
          : null,
        assignedMentorDetails: assignedMentor || null
      },
      telemetry: {
        status: enrollment?.status || 'active',
        enrollmentId: enrollment?.id || null,
        amountPaise: paidPaise,
        couponCode: enrollment?.coupon_code || null,
        isTest: Boolean(enrollment?.is_test || paidPaise === 100),
        paymentAmountLabel: fmtAmountLabel(paidPaise),
        enrolledAt: enrollment?.enrolled_at || null,
        paymentStatus: paymentStatusText,
        receiptNo: enrollment?.receipt_no || null,
        transactionRef: enrollment?.transaction_ref || null,
        assessmentScore: attempt?.score_percent != null ? Number(attempt.score_percent) : null,
        totalRequiredHours: 30,
        completedHours: Math.min(30, Number(completedHours.toFixed(1))),
        progressPercentage: Math.min(100, Math.round((completedHours / 30) * 100)),
        attendancePercentage: attendancePct,
        presentDays,
        absentDays,
        totalDays: attRecords.length,
        assignmentsCompleted: assignmentsDone,
        totalAssignments: 4,
        projectStatus: projectStatusLabel,
        certificateIssued: Boolean(cert),
        certificateStatus: cert ? 'Issued' : (completedHours >= 30 && (attendancePct ?? 0) >= 75 ? 'Eligible for Issuance' : 'In Progress'),
        certificateId: cert?.certificate_id || null
      }
    });
  }));

  // ===================================================================
  // 6. ATTENDANCE MODULE (Authoritative DB records only)
  // ===================================================================
  app.get('/api/student/attendance', auth, wrap(async (req, res) => {
    const { studentId, mode, attRecords, presentDays, absentDays, completedHours, attendancePct } = await loadStudentContext(req);
    res.json({
      provider: 'pgi_integrated',
      studentId,
      mode,
      stats: {
        totalDays: attRecords.length,
        presentDays,
        absentDays,
        attendancePercentage: attendancePct,
        completedHours: Number(completedHours.toFixed(1)),
        totalRequiredHours: 30.0,
        remainingHours: Math.max(0, Number((30.0 - completedHours).toFixed(1))),
        progressPercentage: Math.min(100, Math.round((completedHours / 30.0) * 100))
      },
      records: attRecords
    });
  }));

  // ===================================================================
  // 7. SYLLABUS MODULE (Strictly Enrolled Student's Own Track Only)
  // ===================================================================
  app.get('/api/student/syllabus', auth, wrap(async (req, res) => {
    const { enrollment, appRecord } = await loadStudentContext(req);
    const enrolledDomain = enrollment?.courses?.title || appRecord?.domain_name || 'Web Development';
    const domainType = appRecord?.domain_type || enrollment?.courses?.domain_type || 'Technical';
    const domLower = String(enrolledDomain).toLowerCase();

    const selectedTrackId = (domLower.includes('app') || domLower.includes('mobile') || domLower.includes('android'))
      ? 'tech-app'
      : (domainType === 'Non-Technical' || domLower.includes('marketing') || domLower.includes('business') || domLower.includes('operations'))
        ? 'nontech-marketing'
        : 'tech-web';

    const myTrack = SYLLABUS_TRACKS.find(t => t.id === selectedTrackId) || SYLLABUS_TRACKS[0];

    res.json({
      enrolledTrackId: myTrack.id,
      enrolledDomain: enrolledDomain,
      tracks: [myTrack]
    });
  }));

  // ===================================================================
  // 8. SUBMISSIONS / ASSIGNMENTS MODULE (Real DB + Fallback State Only)
  // ===================================================================
  const baseTasks = [
    {
      id: 'asg-01',
      code: 'MILESTONE 01',
      title: 'Milestone 1: Foundations & Version Control Setup',
      description: 'Initialize your internship GitHub repository, commit clean baseline structure, and configure documentation.',
      dueLabel: 'Module 01–03'
    },
    {
      id: 'asg-02',
      code: 'MILESTONE 02',
      title: 'Milestone 2: Core Track Implementation',
      description: 'Implement primary feature modules aligned with your selected cohort track and push clean commits.',
      dueLabel: 'Module 04–06'
    },
    {
      id: 'asg-03',
      code: 'MILESTONE 03',
      title: 'Milestone 3: Backend Integration & Testing',
      description: 'Connect APIs/validation, verify end-to-end flows, and document test steps or edge cases.',
      dueLabel: 'Module 07–08'
    },
    {
      id: 'capstone',
      code: 'FINAL CAPSTONE',
      title: 'Final Capstone Project Repository & Demo',
      description: 'Submit your completed GitHub repository URL and live deployment/demo link for final mentor evaluation.',
      dueLabel: 'Final Review'
    }
  ];

  function parseSubmissionNotes(raw) {
    if (!raw || typeof raw !== 'string') return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__pgiMeta === 1) return parsed;
    } catch {}
    return { notes: raw };
  }

  function serializeSubmissionNotes(meta) {
    return JSON.stringify({
      __pgiMeta: 1,
      taskKey: meta.taskKey,
      branch: meta.branch || 'main',
      commitRef: meta.commitRef || null,
      demoUrl: meta.demoUrl || null,
      notes: meta.notes || null,
      isDraft: Boolean(meta.isDraft)
    });
  }

  async function loadStudentSubmissions(userId, ctx) {
    const subsMap = { ...(localAssignments.get(userId) || {}) };

    try {
      const { data: rows } = await db
        .from('student_assignments')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (Array.isArray(rows)) {
        for (const r of rows) {
          const meta = parseSubmissionNotes(r.submission_notes);
          const matchedTask = baseTasks.find(t => t.id === meta.taskKey || t.title === r.title);
          if (!matchedTask) continue;

          const effectiveStatus = r.status === 'reviewed'
            ? 'reviewed'
            : (r.status === 'submitted'
              ? 'submitted'
              : (meta.isDraft ? 'draft' : 'pending'));

          subsMap[matchedTask.id] = {
            dbRowId: r.id,
            submissionUrl: r.submission_url || null,
            demoUrl: meta.demoUrl || null,
            branch: meta.branch || 'main',
            commitRef: meta.commitRef || null,
            notes: meta.notes || null,
            submittedAt: r.submitted_at || null,
            isDraft: effectiveStatus === 'draft',
            status: effectiveStatus,
            score: r.score ?? null,
            maxScore: r.max_score || 100,
            feedback: r.feedback || null
          };
        }
      }
    } catch {}

    return baseTasks.map(t => {
      const s = subsMap[t.id] || null;
      const derivedStatus = s?.status || (s ? (s.isDraft ? 'draft' : 'submitted') : 'pending');
      return {
        ...t,
        track: ctx?.enrollment?.courses?.title || ctx?.appRecord?.domain_name || 'Cohort Track',
        status: derivedStatus,
        isDraft: derivedStatus === 'draft',
        submission_url: s?.submissionUrl || null,
        demo_url: s?.demoUrl || null,
        branch: s?.branch || 'main',
        commit_ref: s?.commitRef || null,
        notes: s?.notes || null,
        submittedAt: s?.submittedAt || null,
        score: s?.score ?? null,
        max_score: s?.maxScore || 100,
        feedback: s?.feedback || null
      };
    });
  }

  app.get('/api/student/assignments', auth, wrap(async (req, res) => {
    const ctx = await loadStudentContext(req);
    const list = await loadStudentSubmissions(req.user.id, ctx);
    res.json(list);
  }));

  app.post('/api/student/assignments/:id/submit', auth, wrap(async (req, res) => {
    const task = baseTasks.find(t => t.id === req.params.id);
    if (!task) throw fail(404, 'Unknown submission milestone');

    const { submissionUrl, demoUrl, branch, commitRef, notes, isDraft } = req.body || {};
    const draftMode = Boolean(isDraft);
    const cleanRepo = submissionUrl ? String(submissionUrl).trim() : '';
    const cleanDemo = demoUrl ? String(demoUrl).trim() : '';
    const cleanBranch = branch ? String(branch).trim().slice(0, 80) : 'main';
    const cleanCommit = commitRef ? String(commitRef).trim().slice(0, 80) : '';
    const cleanNotes = notes ? String(notes).trim().slice(0, 2000) : '';

    if (!draftMode && !cleanRepo) {
      throw fail(400, 'Public GitHub repository URL is required to submit');
    }
    if (draftMode && !cleanRepo && !cleanDemo && !cleanNotes) {
      throw fail(400, 'Enter a repository URL, demo link, or notes before saving a draft');
    }
    if (cleanRepo && !/^https?:\/\/\S+/i.test(cleanRepo)) {
      throw fail(400, 'Repository URL must begin with http:// or https://');
    }
    if (cleanDemo && !/^https?:\/\/\S+/i.test(cleanDemo)) {
      throw fail(400, 'Live demo URL must begin with http:// or https://');
    }

    const nowIso = new Date().toISOString();
    const ctx = await loadStudentContext(req);
    const dbStatus = draftMode ? 'pending' : 'submitted';
    const submittedAt = draftMode ? null : nowIso;
    const encodedNotes = serializeSubmissionNotes({
      taskKey: task.id,
      branch: cleanBranch || 'main',
      commitRef: cleanCommit || null,
      demoUrl: cleanDemo || null,
      notes: cleanNotes || null,
      isDraft: draftMode
    });

    const cached = localAssignments.get(req.user.id) || {};
    cached[task.id] = {
      submissionUrl: cleanRepo || null,
      demoUrl: cleanDemo || null,
      branch: cleanBranch || 'main',
      commitRef: cleanCommit || null,
      notes: cleanNotes || null,
      submittedAt,
      isDraft: draftMode,
      status: draftMode ? 'draft' : 'submitted'
    };
    localAssignments.set(req.user.id, cached);

    try {
      const safeStudentId = (ctx.studentId && ctx.studentId !== '—')
        ? ctx.studentId
        : (ctx.appRecord?.application_id || req.user.email || req.user.id);
      const dueDateIso = (ctx.batch?.ends_on && /^\d{4}-\d{2}-\d{2}/.test(String(ctx.batch.ends_on)))
        ? String(ctx.batch.ends_on).slice(0, 10)
        : '2026-12-31';

      const { data: existingRow } = await db
        .from('student_assignments')
        .select('id, status')
        .eq('user_id', req.user.id)
        .eq('title', task.title)
        .maybeSingle();

      const payload = {
        student_id: safeStudentId,
        user_id: req.user.id,
        title: task.title,
        track: ctx.appRecord?.domain_name || ctx.appRecord?.domain_type || 'Technical',
        description: task.description,
        due_date: dueDateIso,
        submission_url: cleanRepo || null,
        submission_notes: encodedNotes,
        submitted_at: submittedAt,
        status: existingRow?.status === 'reviewed' && !draftMode ? 'reviewed' : dbStatus
      };

      if (existingRow?.id) {
        await db.from('student_assignments').update(payload).eq('id', existingRow.id);
      } else {
        await db.from('student_assignments').insert(payload);
      }
    } catch {}

    res.json({
      ok: true,
      assignmentId: task.id,
      status: draftMode ? 'draft' : 'submitted',
      isDraft: draftMode,
      submission_url: cleanRepo || null,
      demo_url: cleanDemo || null,
      branch: cleanBranch || 'main',
      commit_ref: cleanCommit || null,
      notes: cleanNotes || null,
      submittedAt,
      message: draftMode
        ? 'Draft saved. You can complete and submit whenever ready.'
        : 'Submission recorded successfully for mentor evaluation.'
    });
  }));

  // ===================================================================
  // 9. RECORDED VIDEOS & RESOURCES MODULE (Real Resources, No Fake Watch History)
  // ===================================================================
  app.get('/api/student/materials', auth, wrap(async (req, res) => {
    const { enrollment, appRecord } = await loadStudentContext(req);
    const recordings = [];
    const items = [
      {
        title: 'Winter Internship Syllabus & Program Handbook (PDF)',
        type: 'pdf',
        url: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
        description: 'Official 30-hour curriculum reference for Technical and Non-Technical tracks.'
      }
    ];
    if (enrollment?.courses?.access_url) {
      items.push({
        title: `${enrollment.courses.title} — Course Classroom Link`,
        type: 'live',
        url: enrollment.courses.access_url,
        description: 'Direct portal/classroom URL configured for your enrolled track.'
      });
    }

    res.json({
      track: enrollment?.courses?.title || appRecord?.domain_name || null,
      recordings,
      categories: [{ category: 'Program Documents', items }]
    });
  }));

  // ===================================================================
  // 10. MENTORS MODULE (Real DB Mentors Table Only)
  // ===================================================================
  app.get('/api/student/mentors', auth, wrap(async (req, res) => {
    const { assignedMentor, batch, appRecord, mode } = await loadStudentContext(req);
    let mentorsList = [];
    try {
      const { data } = await db
        .from('mentors')
        .select('id,name,email,domain,title,bio,active')
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (data) mentorsList = data;
    } catch {}

    res.json({
      assignedMentorId: assignedMentor?.id || null,
      assignedMentor: assignedMentor || null,
      batchName: batch?.name || 'Winter Cohort 2026',
      mode,
      timings: batch?.timings || (mode === 'Offline' ? '9:00 AM – 6:00 PM IST' : '4:00 PM – 6:00 PM IST'),
      track: appRecord?.domain_name || null,
      mentors: mentorsList
    });
  }));

  // ===================================================================
  // 11. OFFICIAL COMPLIMENTARY 1-PAGE PROJECT REPORT PDF
  // ===================================================================
  app.get('/api/student/project-report.pdf', auth, wrap(async (req, res) => {
    const { profile, enrollment, appRecord, assignedMentor, studentId, mode } = await loadStudentContext(req);
    const chosenDomain = enrollment?.courses?.title || appRecord?.domain_name || 'Winter Internship Program';
    const pdfBuf = await buildProjectReportPDF({
      name: profile?.full_name || appRecord?.full_name || req.user.user_metadata?.full_name || 'Student',
      studentId,
      college: appRecord?.college || null,
      department: appRecord?.department || null,
      courseTitle: chosenDomain,
      domainName: chosenDomain,
      domainType: appRecord?.domain_type || null,
      mode,
      mentorName: assignedMentor?.name || 'Plant Green Inertia Academic Team',
      date: new Date()
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="PGI-Project-Report-${studentId}.pdf"`,
      'Cache-Control': 'private, no-store'
    }).send(pdfBuf);
  }));

  // ===================================================================
  // 12. CERTIFICATES & SUPPORT MODULES (Real DB Eligibility Check)
  // ===================================================================
  app.get('/api/student/certificates', auth, wrap(async (req, res) => {
    const {
      profile, enrollment, appRecord, batch, studentId, cert, completedHours, attendancePct, presentDays
    } = await loadStudentContext(req);
    const eligible = Boolean(cert || (completedHours >= 30 && (attendancePct ?? 0) >= 75));
    const studentName = profile?.full_name || appRecord?.full_name || req.user.user_metadata?.full_name || 'Student';
    res.json({
      eligible,
      issued: Boolean(cert),
      certificateId: cert?.certificate_id || null,
      completedHours: Number(completedHours.toFixed(1)),
      requiredHours: 30,
      attendancePct: attendancePct ?? 0,
      presentDays,
      issuedOn: cert?.issued_at || null,
      verificationUrl: cert?.verification_url || null,
      downloadUrl: cert?.certificate_id ? '/api/student/certificates/download.pdf' : null,
      title: cert?.domain || enrollment?.courses?.title || appRecord?.domain_name || 'Winter Internship & Training Program',
      batchName: batch?.name || 'Winter Cohort 2026',
      internshipPeriod: appRecord?.internship_period || null,
      studentName,
      studentId
    });
  }));

  app.get('/api/student/certificates/download.pdf', auth, wrap(async (req, res) => {
    const { cert, studentId, attendancePct } = await loadStudentContext(req);
    if (!cert || !cert.certificate_id) {
      throw fail(404, 'Certificate has not been issued yet.');
    }

    const pdfBuffer = await buildCertificatePDF({
      certificateNumber: cert.certificate_id,
      studentId: cert.student_id || studentId,
      studentName: cert.student_name || 'Student',
      domain: cert.domain || 'Winter Internship Program',
      duration: cert.duration || '30 Hours',
      attendancePercentage: cert.attendance_percentage ?? attendancePct ?? 0,
      completionDate: new Date(cert.issued_at || Date.now()).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      verificationUrl: cert.verification_url
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${cert.certificate_id}.pdf"`,
      'Cache-Control': 'private, no-store'
    }).send(pdfBuffer);
  }));

  app.get('/api/student/support', auth, wrap(async (req, res) => {
    const tickets = sharedSupportTickets
      .filter(t => t.userId === req.user.id)
      .slice()
      .reverse();
    res.json({ tickets });
  }));

  app.post('/api/student/support', auth, wrap(async (req, res) => {
    const { subject, category, message, priority, attachmentNote } = req.body || {};
    if (!subject || !message) throw fail(400, 'Subject and message are required');

    const ticket = {
      id: 'TICK-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: req.user.id,
      email: req.user.email,
      subject: String(subject).trim(),
      category: category || 'Academic',
      message: String(message).trim(),
      attachmentNote: attachmentNote ? String(attachmentNote).trim() : null,
      priority: priority || 'Normal',
      status: 'Open',
      adminReply: null,
      createdAt: new Date().toISOString()
    };

    sharedSupportTickets.push(ticket);
    res.json({
      ok: true,
      ticketId: ticket.id,
      ticket,
      message: 'Support ticket submitted. An academic coordinator will contact you shortly.'
    });
  }));
}
