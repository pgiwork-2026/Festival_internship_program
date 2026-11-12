import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { sendPasswordResetEmail } from './email.js';
import { buildProjectReportPDF } from './project_report.js';
import { buildCertificatePDF } from './certificate.js';
import { SYLLABUS_TRACKS, normalizeLoginPassword, parseDobCredentials, sharedSupportTickets, loadRecordedVideos, resolveCanonicalDomain, matchesStudentDomain } from './logic.js';

// In-memory fallback stores for offline testing and development
const localPasswordResets = new Map();
const localAttendance = new Map();
const localAssignments = new Map();
const localProjects = new Map();

const EXCLUDED_ENROLLMENT_STATUSES = new Set(['cancelled', 'refunded', 'failed', 'dropped']);

function portalSessionSecret() {
  return process.env.PORTAL_SESSION_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.RAZORPAY_KEY_SECRET
    || 'pgi-portal-session-fallback-key';
}

export function signPortalSession(userId, studentId = '', ttlMs = 30 * 24 * 3600 * 1000) {
  const payload = Buffer.from(JSON.stringify({
    uid: String(userId || ''),
    sid: String(studentId || ''),
    exp: Date.now() + ttlMs
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', portalSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyPortalSession(token, expectedUserId) {
  const raw = String(token || '').trim();
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', portalSessionSecret()).update(payload).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || !data.uid || Number(data.exp || 0) <= Date.now()) return null;
    if (expectedUserId && String(data.uid) !== String(expectedUserId)) return null;
    return data;
  } catch {
    return null;
  }
}

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

  async function findActiveEnrollmentForUser(userId) {
    if (!userId) return null;
    try {
      const { data } = await db.from('enrollments')
        .select('*, courses(*)')
        .eq('user_id', userId)
        .order('enrolled_at', { ascending: false })
        .limit(5);
      const list = Array.isArray(data) ? data : (data ? [data] : []);
      return list.find(e => !EXCLUDED_ENROLLMENT_STATUSES.has(String(e?.status || 'active').toLowerCase())) || null;
    } catch {
      return null;
    }
  }

  async function resolvePaidStudentByKey(identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) throw fail(400, 'Private Key (Student ID) and Secret Key are required.');

    const upperRaw = raw.toUpperCase();
    if (raw.includes('@') || /^PGI-W\d{2}-/i.test(upperRaw)) {
      throw fail(403, 'Assessment email and password are not allowed for the Student Portal. Enter the Private Key (Student ID) and Secret Key copied after payment.');
    }

    try {
      const { data: prof } = await db.from('profiles')
        .select('id, student_id, full_name, phone')
        .ilike('student_id', raw)
        .maybeSingle();

      if (prof?.id) {
        const { data: u } = await db.auth.admin.getUserById(prof.id);
        if (u?.user?.email) {
          return { user: u.user, email: u.user.email, profile: prof, studentId: prof.student_id || upperRaw };
        }
      }
    } catch {}

    try {
      const { data: enr } = await db.from('enrollments')
        .select('user_id, student_id, status')
        .ilike('student_id', raw)
        .order('enrolled_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (enr?.user_id) {
        const { data: u } = await db.auth.admin.getUserById(enr.user_id);
        if (u?.user?.email) {
          return { user: u.user, email: u.user.email, studentId: enr.student_id || upperRaw };
        }
      }
    } catch {}

    try {
      const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const matchedUser = (uList?.users || []).find(
        u => String(u.user_metadata?.student_id || '').toUpperCase() === upperRaw
      );
      if (matchedUser?.email) {
        return { user: matchedUser, email: matchedUser.email, studentId: matchedUser.user_metadata.student_id || upperRaw };
      }
    } catch {}

    throw fail(404, `No paid Student ID (Private Key) found for "${raw}". Complete payment first and copy your Private Key and Secret Key.`);
  }

  async function resolveDobCredentialsForUser(user, email) {
    const meta = user?.user_metadata || {};
    let dobStr = meta.dob || null;
    if (!dobStr && email) {
      try {
        const { data: appRec } = await db.from('internship_applications')
          .select('dob')
          .ilike('email', email)
          .limit(1)
          .maybeSingle();
        dobStr = appRec?.dob || null;
      } catch {}
    }
    return dobStr ? parseDobCredentials(dobStr) : null;
  }

  async function mintMagicLinkSession(authClient, email) {
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
    return null;
  }

  // ===================================================================
  // 1. ASSESSMENT PORTAL LOGIN (Email / Candidate UID + DOB Password)
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

      const dobCreds = meta.password_customized ? null : await resolveDobCredentialsForUser(targetUser, email);
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

      const verified = await mintMagicLinkSession(authClient, email);
      if (verified?.data?.session) return verified;
    } catch {}
    return null;
  }

  app.post('/api/assessment/login', wrap(async (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      throw fail(400, 'Candidate UID / Email and Date of Birth password are required');
    }

    const { email, studentId, applicationId } = await resolveUserByIdentifier(identifier);
    const normalizedPassword = normalizeLoginPassword(password);
    const authClient = makeAuthClient();

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

    const enrollment = await findActiveEnrollmentForUser(user.id);
    const resolvedStudentId = studentId || enrollment?.student_id || user.user_metadata?.student_id || null;
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
        name: user.user_metadata?.full_name || 'Candidate',
        enrolled: !!enrollment
      }
    });
  }));

  // ===================================================================
  // 1B. STUDENT PORTAL LOGIN (Strictly Paid Students: Private Key / Student ID + Secret Key Only)
  // ===================================================================
  const handleStudentLogin = wrap(async (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      throw fail(400, 'Private Key (Student ID) and Secret Key are required.');
    }

    const trimmedSecret = String(password).trim();
    const normalizedPassword = normalizeLoginPassword(trimmedSecret);
    const { user: foundUser, email, studentId, profile: resolvedProfile } = await resolvePaidStudentByKey(identifier);

    let targetUser = foundUser || null;
    if (!targetUser) {
      try {
        const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
        targetUser = (uList?.users || []).find(
          u => String(u.email || '').toLowerCase() === String(email || '').toLowerCase()
        ) || null;
      } catch {}
    }
    if (!targetUser?.id) {
      throw fail(404, 'Student account not found.');
    }

    const enrollment = await findActiveEnrollmentForUser(targetUser.id);
    if (!enrollment) {
      throw fail(403, 'Payment not completed. Complete your cohort payment first and copy your Private Key (Student ID) and Secret Key to access the Student Portal.');
    }

    const meta = targetUser.user_metadata || {};
    const dobCreds = await resolveDobCredentialsForUser(targetUser, email);
    if (dobCreds?.password && (normalizedPassword === dobCreds.password || trimmedSecret === dobCreds.password)) {
      throw fail(401, 'Assessment DOB password cannot be used on Student Portal login. Enter the Secret Key copied after payment.');
    }

    const authClient = makeAuthClient();
    const expectedSecret = meta.portal_access_key ? String(meta.portal_access_key).trim() : '';
    let authRes = null;

    if (expectedSecret && trimmedSecret === expectedSecret) {
      authRes = await mintMagicLinkSession(authClient, email);
      if ((!authRes || authRes.error || !authRes.data?.session) && db.auth?.admin?.updateUserById && !meta.dob) {
        try {
          authRes = await authClient.auth.signInWithPassword({ email, password: trimmedSecret });
        } catch {}
      }
      if (!authRes || authRes.error || !authRes.data?.session) {
        if (process.env.NODE_ENV === 'test' || !db.auth?.admin?.generateLink) {
          authRes = {
            data: {
              user: targetUser,
              session: {
                access_token: 'pgi_portal_tok_' + crypto.randomBytes(16).toString('hex'),
                refresh_token: 'pgi_portal_ref_' + crypto.randomBytes(12).toString('hex'),
                expires_at: Math.floor(Date.now() / 1000) + 3600
              }
            },
            error: null
          };
        }
      }
    } else if (meta.password_customized === true) {
      try {
        authRes = await authClient.auth.signInWithPassword({ email, password: trimmedSecret });
      } catch (err) {
        throw fail(401, 'Invalid Private Key (Student ID) or Secret Key.');
      }
    } else {
      throw fail(401, 'Invalid Private Key (Student ID) or Secret Key. Copy both keys from your Payment Confirmation receipt.');
    }

    if (!authRes || authRes.error || !authRes.data?.session) {
      throw fail(401, authRes?.error?.message || 'Unable to verify Student Portal Secret Key.');
    }

    const session = authRes.data.session;
    const user = authRes.data.user || targetUser;
    if (onAuth && session?.access_token && user) onAuth(session.access_token, user);

    let profile = resolvedProfile || null;
    if (!profile) {
      try {
        const { data: pData } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
        profile = pData;
      } catch {}
    }

    const resolvedStudentId = studentId || profile?.student_id || enrollment?.student_id || meta.student_id;
    const portalSessionToken = signPortalSession(user.id, resolvedStudentId);

    res.json({
      ok: true,
      token: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      portalSessionToken,
      student: {
        id: user.id,
        email: user.email,
        studentId: resolvedStudentId,
        applicationId: meta.application_id || null,
        name: profile?.full_name || meta.full_name || 'Candidate',
        phone: profile?.phone || meta.phone || '',
        enrolled: true
      }
    });
  });

  app.post('/api/student/login', handleStudentLogin);
  app.post('/api/auth/student-login', handleStudentLogin);

  // ===================================================================
  // 2. PASSWORD RECOVERY (FORGOT SECRET KEY — PAID STUDENTS ONLY)
  // ===================================================================
  app.post('/api/student/forgot-password', wrap(async (req, res) => {
    const { identifier } = req.body || {};
    if (!identifier) throw fail(400, 'Private Key (Student ID) or registered email is required');

    let resolved = null;
    try {
      resolved = await resolveUserByIdentifier(identifier);
    } catch {
      return res.json({
        ok: true,
        message: 'If an enrolled account exists with this identifier, Secret Key recovery instructions have been emailed.'
      });
    }

    const email = resolved.email;
    let targetUserId = resolved.profile?.id || null;
    let resolvedStudentId = resolved.studentId || null;
    if (!targetUserId) {
      try {
        const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const matched = (uList?.users || []).find(u => String(u.email || '').toLowerCase() === String(email || '').toLowerCase());
        targetUserId = matched?.id || null;
        if (!resolvedStudentId) resolvedStudentId = matched?.user_metadata?.student_id || null;
      } catch {}
    }

    const enrollment = await findActiveEnrollmentForUser(targetUserId);
    if (!enrollment) {
      return res.json({
        ok: true,
        message: 'If an enrolled account exists with this identifier, Secret Key recovery instructions have been emailed.'
      });
    }
    if (!resolvedStudentId) resolvedStudentId = enrollment.student_id || null;

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
      studentId: resolvedStudentId,
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
  // 3. RESET SECRET KEY CONFIRMATION (PAID STUDENTS ONLY, DOB DISALLOWED)
  // ===================================================================
  app.post('/api/student/reset-password', wrap(async (req, res) => {
    const { token, email, newPassword } = req.body || {};
    if (!token || !newPassword) throw fail(400, 'Reset token and new Secret Key are required');
    const cleanNewSecret = String(newPassword).trim();
    if (cleanNewSecret.length < 8) throw fail(400, 'Secret Key must be at least 8 characters long');

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

    if (!record) throw fail(400, 'Invalid or expired recovery link. Please request a new one.');

    const targetEmail = record.email || email;
    let studentId = null;

    const { data: users } = await db.auth.admin.listUsers();
    const u = (users?.users || []).find(x => x.email?.toLowerCase() === targetEmail.toLowerCase());
    if (!u) throw fail(404, 'Enrolled student account not found.');

    const enrollment = await findActiveEnrollmentForUser(u.id);
    if (!enrollment) throw fail(403, 'Payment not completed. Student Portal access requires active enrollment.');

    const dobCreds = await resolveDobCredentialsForUser(u, targetEmail);
    if (dobCreds?.password && normalizeLoginPassword(cleanNewSecret) === dobCreds.password) {
      throw fail(400, 'For security, your Date of Birth (DDMMYYYY) cannot be set as your Student Portal Secret Key.');
    }

    studentId = enrollment.student_id || u.user_metadata?.student_id || null;
    try {
      await db.auth.admin.updateUserById(u.id, {
        user_metadata: {
          ...(u.user_metadata || {}),
          portal_access_key: cleanNewSecret,
          password_customized: true
        }
      });
    } catch (err) {
      console.warn('[Admin Update Secret Key Error]', err.message);
    }

    // Mark token as used
    try {
      await db.from('password_resets').update({ used: true }).eq('token', token);
    } catch {}
    if (localPasswordResets.has(token)) localPasswordResets.get(token).used = true;

    res.json({
      ok: true,
      studentId,
      message: 'Your Student Portal Secret Key has been updated. Sign in with your Private Key (Student ID) and new Secret Key.'
    });
  }));

  // Requires BOTH active paid enrollment AND valid HMAC portal session from Private Key + Secret Key login
  const portalAuth = (req, _res, next) => {
    Promise.resolve().then(async () => {
      const enr = await findActiveEnrollmentForUser(req.user?.id);
      if (!enr) {
        throw fail(403, 'Payment not completed. Complete payment and sign in using your Private Key (Student ID) and Secret Key to access the Student Portal.');
      }
      const ps = verifyPortalSession(req.headers?.['x-portal-session'], req.user?.id);
      if (!ps) {
        throw fail(401, 'Student Portal login required. Sign in with your Private Key (Student ID) and Secret Key.');
      }
      next();
    }).catch(next);
  };

  // ===================================================================
  // 4. SECRET KEY / PASSWORD CHANGE (AUTHENTICATED PAID STUDENT)
  // ===================================================================
  app.post('/api/student/change-password', auth, portalAuth, wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) throw fail(400, 'Current Secret Key and new Secret Key are required');
    const cleanCurr = String(currentPassword).trim();
    const cleanNext = String(newPassword).trim();
    if (cleanNext.length < 8) throw fail(400, 'New Secret Key must be at least 8 characters');

    const { data: uData } = await db.auth.admin.getUserById(req.user.id);
    const targetUser = uData?.user || req.user;
    const existingMeta = targetUser.user_metadata || {};
    const expectedSecret = existingMeta.portal_access_key ? String(existingMeta.portal_access_key).trim() : '';

    let verifiedCurrent = Boolean(expectedSecret && cleanCurr === expectedSecret);
    if (!verifiedCurrent && existingMeta.password_customized === true) {
      const { error: signInErr } = await makeAuthClient().auth.signInWithPassword({
        email: req.user.email,
        password: cleanCurr
      });
      if (!signInErr) verifiedCurrent = true;
    }
    if (!verifiedCurrent) throw fail(401, 'Current Secret Key is incorrect');

    const dobCreds = await resolveDobCredentialsForUser(targetUser, req.user.email);
    if (dobCreds?.password && normalizeLoginPassword(cleanNext) === dobCreds.password) {
      throw fail(400, 'Date of Birth (DDMMYYYY) cannot be used as your Student Portal Secret Key.');
    }

    await db.auth.admin.updateUserById(req.user.id, {
      user_metadata: { ...existingMeta, portal_access_key: cleanNext, password_customized: true }
    });

    res.json({ ok: true, message: 'Secret Key updated successfully.' });
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
  app.get('/api/student/dashboard', auth, portalAuth, wrap(async (req, res) => {
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
  app.get('/api/student/attendance', auth, portalAuth, wrap(async (req, res) => {
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
  app.get('/api/student/syllabus', auth, portalAuth, wrap(async (req, res) => {
    const { enrollment, appRecord } = await loadStudentContext(req);
    const enrolledDomain = appRecord?.domain_name || enrollment?.courses?.title || 'Web Development & Full Stack Development';
    const canonicalDomain = resolveCanonicalDomain(enrolledDomain);
    const myTrack = SYLLABUS_TRACKS.find(t => t.title === canonicalDomain) || SYLLABUS_TRACKS[0];

    res.json({
      enrolledTrackId: myTrack.id,
      enrolledDomain: canonicalDomain || enrolledDomain,
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

  app.get('/api/student/assignments', auth, portalAuth, wrap(async (req, res) => {
    const ctx = await loadStudentContext(req);
    const list = await loadStudentSubmissions(req.user.id, ctx);
    res.json(list);
  }));

  app.post('/api/student/assignments/:id/submit', auth, portalAuth, wrap(async (req, res) => {
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
  app.get('/api/student/materials', auth, portalAuth, wrap(async (req, res) => {
    const { enrollment, appRecord, mode } = await loadStudentContext(req);
    const rawDomain = String(appRecord?.domain_name || enrollment?.courses?.title || '').trim();
    const chosenDomain = resolveCanonicalDomain(rawDomain) || rawDomain;
    const studentModeLow = String(mode || 'Online').toLowerCase();

    const allVideos = await loadRecordedVideos(db);
    const recordings = allVideos
      .filter(v => {
        const vm = String(v.mode || 'all').trim().toLowerCase();
        const domainAllowed = matchesStudentDomain(v.track, chosenDomain);
        const modeMatch = !vm || vm === 'all' || vm === studentModeLow;
        return domainAllowed && modeMatch;
      })
      .map(v => ({
        id: v.id,
        title: v.title,
        url: v.youtube_url,
        youtubeId: v.youtube_id,
        embedUrl: v.embed_url,
        thumbnailUrl: v.thumbnail_url,
        track: v.track,
        mode: v.mode,
        sessionNumber: v.session_number || 'SESSION',
        duration: v.duration || 'YouTube',
        instructor: v.instructor || 'Plant Green Inertia Mentor',
        recordedDate: v.created_at ? new Date(v.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        summary: v.summary || 'Recorded cohort lecture video.'
      }));

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
      track: chosenDomain || null,
      recordings,
      categories: [{ category: 'Program Documents', items }]
    });
  }));

  // ===================================================================
  // 10. MENTORS MODULE (Real DB Mentors Table Only)
  // ===================================================================
  app.get('/api/student/mentors', auth, portalAuth, wrap(async (req, res) => {
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
  app.get('/api/student/project-report.pdf', auth, portalAuth, wrap(async (req, res) => {
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
  app.get('/api/student/certificates', auth, portalAuth, wrap(async (req, res) => {
    const {
      profile, enrollment, appRecord, batch, studentId, cert, attRecords, completedHours, attendancePct, presentDays
    } = await loadStudentContext(req);
    const eligible = Boolean(cert || (completedHours >= 30 && (attendancePct ?? 0) >= 75));
    const studentName = profile?.full_name || appRecord?.full_name || req.user.user_metadata?.full_name || 'Student';
    const fmtD = v => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
    const startDate = fmtD(cert?.start_date || batch?.starts_on || attRecords?.[0]?.date || enrollment?.enrolled_at || cert?.issued_at);
    const endDate = fmtD(cert?.end_date || batch?.ends_on || attRecords?.[attRecords.length - 1]?.date || cert?.issued_at);
    res.json({
      eligible,
      issued: Boolean(cert),
      certificateId: cert?.certificate_id || null,
      completedHours: Number(completedHours.toFixed(1)),
      requiredHours: 30,
      attendancePct: attendancePct ?? 0,
      presentDays,
      issuedOn: cert?.issued_at || null,
      startDate,
      endDate,
      verificationUrl: cert?.verification_url || null,
      downloadUrl: cert?.certificate_id ? '/api/student/certificates/download.pdf' : null,
      title: cert?.domain || enrollment?.courses?.title || appRecord?.domain_name || 'Winter Internship & Training Program',
      batchName: batch?.name || 'Winter Cohort 2026',
      internshipPeriod: appRecord?.internship_period || null,
      studentName,
      studentId
    });
  }));

  app.get('/api/student/certificates/download.pdf', auth, portalAuth, wrap(async (req, res) => {
    const { cert, batch, enrollment, attRecords, studentId, attendancePct } = await loadStudentContext(req);
    if (!cert || !cert.certificate_id) {
      throw fail(404, 'Certificate has not been issued yet.');
    }

    const startDate = cert.start_date || batch?.starts_on || attRecords?.[0]?.date || enrollment?.enrolled_at || cert.issued_at;
    const endDate = cert.end_date || batch?.ends_on || attRecords?.[attRecords.length - 1]?.date || cert.issued_at;

    const pdfBuffer = await buildCertificatePDF({
      certificateNumber: cert.certificate_id,
      studentId: cert.student_id || studentId,
      studentName: cert.student_name || 'Student',
      domain: cert.domain || 'Winter Internship Program',
      duration: cert.duration || '30 Hours',
      attendancePercentage: cert.attendance_percentage ?? attendancePct ?? 0,
      startDate,
      endDate,
      completionDate: new Date(cert.issued_at || Date.now()).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
      verificationUrl: cert.verification_url
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${cert.certificate_id}.pdf"`,
      'Cache-Control': 'private, no-store'
    }).send(pdfBuffer);
  }));

  app.get('/api/student/support', auth, portalAuth, wrap(async (req, res) => {
    const tickets = sharedSupportTickets
      .filter(t => t.userId === req.user.id)
      .slice()
      .reverse();
    res.json({ tickets });
  }));

  app.post('/api/student/support', auth, portalAuth, wrap(async (req, res) => {
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
