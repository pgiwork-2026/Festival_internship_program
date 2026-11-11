/**
 * Email Notification Service
 * Sends branded confirmation emails to applicants upon enquiry form submission
 * and coupon issuance upon assessment qualification.
 */
import { winterPayablePaise } from './logic.js';

function couponPayableSummary(coupon) {
  const paise = winterPayablePaise(coupon);
  if (paise === 0) return '₹0 (100% Full Scholarship)';
  if (paise === 119900) return '₹1,199 (₹9,999 fee with 0%–12% tier scholarship)';
  if (paise === 99900) return '₹999 (₹9,999 fee with 16%–96% tier scholarship)';
  return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
}

export function buildConfirmationEmailHtml(app) {
  const timing = app.mode === 'Online'
    ? 'Online Evening: 4:00 PM – 6:00 PM IST (Remote Interactive Classroom)'
    : 'Offline Full-Day: 9:00 AM – 6:00 PM IST (Plant Green Inertia Office, Maduravoyal, Chennai with Pre-Placement consideration)';

  const portalBase = (process.env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
  const assessmentUrl = `${portalBase}/portal.html?mode=login&appId=${encodeURIComponent(app.applicationId)}&email=${encodeURIComponent(app.email)}${app.referralCode ? `&ref=${encodeURIComponent(app.referralCode)}` : ''}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Application Confirmed - Plant Green Inertia</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F5FAFF; margin: 0; padding: 20px; color: #101D35; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #D8E2EC; overflow: hidden; box-shadow: 0 4px 18px rgba(16,29,53,0.06); }
    .header { background: #101D35; padding: 28px 24px; text-align: center; color: #F5FAFF; }
    .header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 0; font-size: 13px; color: #B9DDF5; text-transform: uppercase; letter-spacing: 0.1em; }
    .content { padding: 30px 28px; line-height: 1.6; }
    .badge { display: inline-block; background: #DCEEFF; color: #101D35; font-size: 14px; font-weight: 700; padding: 6px 14px; border-radius: 999px; margin: 12px 0 20px; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .table td { padding: 10px 12px; border-bottom: 1px solid #EBF2F8; font-size: 14px; }
    .table td.label { font-weight: 700; color: #627D98; width: 38%; }
    .table td.value { color: #101D35; font-weight: 600; }
    .cta-box { text-align: center; margin: 30px 0; padding: 24px; background: #F5FAFF; border: 1px dashed #B9DDF5; border-radius: 10px; }
    .btn { display: inline-block; background: #296934; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 12px 28px; border-radius: 8px; }
    .footer { background: #F5FAFF; padding: 20px 24px; text-align: center; font-size: 12px; color: #627D98; border-top: 1px solid #EBF2F8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Plant Green Inertia Pvt. Ltd.</h1>
      <p>Winter Internship &amp; Training Program</p>
    </div>
    <div class="content">
      <h2>Application Received!</h2>
      <p>Dear <strong>${escapeHtml(app.fullName)}</strong>,</p>
      <p>Thank you for applying for the Winter Internship and Training Program. Your application has been successfully logged with our admissions desk.</p>
      
      <div style="text-align:center;">
        <span class="badge">Application ID: ${escapeHtml(app.applicationId)}</span>
      </div>

      <table class="table">
        <tr><td class="label">Candidate Name</td><td class="value">${escapeHtml(app.fullName)}</td></tr>
        <tr><td class="label">Email Address</td><td class="value">${escapeHtml(app.email)}</td></tr>
        <tr><td class="label">Mobile Number</td><td class="value">${escapeHtml(app.phone)}</td></tr>
        <tr><td class="label">College &amp; Dept</td><td class="value">${escapeHtml(app.college)} &middot; ${escapeHtml(app.department)}</td></tr>
        <tr><td class="label">Passed-out Year</td><td class="value">${escapeHtml(app.passedOutYear)}</td></tr>
        <tr><td class="label">Specialization Domain</td><td class="value">${escapeHtml(app.domainName)} (${escapeHtml(app.domainType)})</td></tr>
        <tr><td class="label">Training Mode</td><td class="value">${escapeHtml(app.mode)}</td></tr>
        <tr><td class="label">Schedule &amp; Timings</td><td class="value">${timing}</td></tr>
        <tr><td class="label">Duration &amp; Period</td><td class="value">30 Hours &middot; ${escapeHtml(app.internshipPeriod)}</td></tr>
        ${app.referralCode ? `<tr><td class="label">Referral Code</td><td class="value">${escapeHtml(app.referralCode)}</td></tr>` : ''}
      </table>

      ${app.password ? `
      <div style="background:#F5FAFF; border:1px solid #296934; border-radius:10px; padding:18px 20px; margin:20px 0;">
        <h3 style="margin:0 0 8px 0; color:#296934; font-size:15px;">Your Assessment Login Credentials</h3>
        <p style="margin:0 0 10px 0; font-size:13.5px; color:#1E293B;">Use these credentials to sign in to the proctored assessment portal:</p>
        <p style="margin:4px 0; font-size:14px;"><strong>Login Email:</strong> <code>${escapeHtml(app.email)}</code></p>
        <p style="margin:4px 0; font-size:14px;"><strong>Password (DOB · DDMMYYYY):</strong> <code>${escapeHtml(app.password)}</code></p>
      </div>` : ''}

      <div class="cta-box">
        <h3 style="margin:0 0 8px 0; color:#101D35;">Next Step: Scholarship Assessment</h3>
        <p style="margin:0 0 16px 0; font-size:14px; color:#33475B;">Complete your 100-mark proctored assessment to unlock your merit scholarship (up to 100% full tuition coverage).</p>
        <a class="btn" href="${assessmentUrl}">Start Your Assessment Now &rarr;</a>
      </div>

      <p style="font-size:13px; color:#627D98;">
        <strong>Important:</strong> Please retain your Application ID (<strong>${escapeHtml(app.applicationId)}</strong>) for all future admissions, scholarship verification, and batch onboarding correspondence.
      </p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Plant Green Inertia Pvt. Ltd.<br>
      No:4, 1st Floor, Alapakkam Main Road, Maduravoyal, Chennai - 600095<br>
      Email: plantgreeninertia@gmail.com | Phone: +91 82206 99083</p>
    </div>
  </div>
</body>
</html>`;
}

export function buildConfirmationEmailText(app) {
  const portalBase = (process.env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
  const assessmentUrl = `${portalBase}/portal.html?mode=login&appId=${encodeURIComponent(app.applicationId)}&email=${encodeURIComponent(app.email)}`;
  
  return `Plant Green Inertia Pvt. Ltd. - Winter Internship Application Confirmed
===================================================================

Dear ${app.fullName},

Thank you for applying for the Winter Internship and Training Program.
Your application has been received and registered.

APPLICATION DETAILS:
-------------------
Application ID:    ${app.applicationId}
Candidate Name:    ${app.fullName}
Email:             ${app.email}
Phone:             ${app.phone}
College:           ${app.college} (${app.department})
Passed-out Year:   ${app.passedOutYear}
Domain:            ${app.domainName} (${app.domainType})
Mode:              ${app.mode}
Duration:          30 Hours
Internship Period: ${app.internshipPeriod}
${app.referralCode ? `Referral:          ${app.referralCode}\n` : ''}${app.password ? `
ASSESSMENT LOGIN CREDENTIALS:
---------------------------
Login Email:       ${app.email}
Password (DOB):    ${app.password}
` : ''}
NEXT STEP:
----------
Take your 100-mark online proctored scholarship assessment to claim up to 100% scholarship:
${assessmentUrl}

For assistance, email us at plantgreeninertia@gmail.com or call +91 82206 99083.

Plant Green Inertia Pvt. Ltd.
Maduravoyal, Chennai - 600095
`;
}

export function buildCouponEmailHtml(student, coupon) {
  const portalBase = (process.env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
  const enrollUrl = `${portalBase}/portal.html?coupon=${encodeURIComponent(coupon.code)}`;
  const expiresAtFormatted = new Date(coupon.expires_at || coupon.expiresAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const payableText = couponPayableSummary(coupon);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Scholarship Unlocked - Plant Green Inertia</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F5FAFF; margin: 0; padding: 20px; color: #101D35; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #D8E2EC; overflow: hidden; box-shadow: 0 4px 18px rgba(16,29,53,0.06); }
    .header { background: #101D35; padding: 28px 24px; text-align: center; color: #F5FAFF; }
    .header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 0; font-size: 13px; color: #B9DDF5; text-transform: uppercase; letter-spacing: 0.1em; }
    .content { padding: 30px 28px; line-height: 1.6; }
    .coupon-card { text-align: center; margin: 24px 0; padding: 24px; background: linear-gradient(135deg, #F5FAFF 0%, #DCEEFF 100%); border: 2px dashed #296934; border-radius: 12px; }
    .coupon-code { font-family: monospace; font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #296934; margin: 10px 0; }
    .badge { display: inline-block; background: #296934; color: #ffffff; font-size: 13px; font-weight: 700; padding: 4px 12px; border-radius: 999px; }
    .timer-alert { background: #FFF4E5; border: 1px solid #FFE0B2; color: #B76E00; padding: 12px 16px; border-radius: 8px; font-size: 14px; margin: 18px 0; text-align: center; }
    .btn { display: inline-block; background: #296934; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 16px; padding: 14px 32px; border-radius: 8px; margin-top: 12px; }
    .footer { background: #F5FAFF; padding: 20px 24px; text-align: center; font-size: 12px; color: #627D98; border-top: 1px solid #EBF2F8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Plant Green Inertia Pvt. Ltd.</h1>
      <p>Winter Internship &amp; Training Program</p>
    </div>
    <div class="content">
      <h2 style="color:#296934; margin-top:0;">Scholarship Unlocked!</h2>
      <p>Dear <strong>${escapeHtml(student.fullName || student.name || 'Candidate')}</strong>,</p>
      <p>Congratulations! You have qualified in the Winter Internship Merit Assessment with a score of <strong>${student.score || coupon.score_percent || 0}%</strong>.</p>
      
      <div class="coupon-card">
        <span class="badge">Merit Scholarship Voucher</span>
        <div class="coupon-code">${escapeHtml(coupon.code)}</div>
        <p style="margin:4px 0; font-size:15px; color:#101D35;">
          <strong>Student Fee: ${payableText}</strong>
        </p>
      </div>

      <div class="timer-alert">
        <strong>&#9200; Valid for exactly 24 hours</strong><br>
        Expires on: <strong>${expiresAtFormatted} IST</strong><br>
        <span style="font-size:12px;">This single-use code is tied directly to your email (${escapeHtml(student.email)}).</span>
      </div>

      <div style="text-align:center; margin: 24px 0;">
        <a class="btn" href="${enrollUrl}">Select Course &amp; Enroll Now &rarr;</a>
      </div>

      <p style="font-size:13px; color:#627D98;">
        After 24 hours, the coupon expires and payment will be locked. In case of unexpected delay, up to two 24-hour extensions may be requested from the portal.
      </p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Plant Green Inertia Pvt. Ltd.<br>
      No:4, 1st Floor, Alapakkam Main Road, Maduravoyal, Chennai - 600095<br>
      Email: plantgreeninertia@gmail.com | Phone: +91 82206 99083</p>
    </div>
  </div>
</body>
</html>`;
}

export function buildCouponEmailText(student, coupon) {
  const portalBase = (process.env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
  const enrollUrl = `${portalBase}/portal.html?coupon=${encodeURIComponent(coupon.code)}`;
  const expiresAtFormatted = new Date(coupon.expires_at || coupon.expiresAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const payableText = couponPayableSummary(coupon);

  return `Plant Green Inertia - Scholarship Unlocked!
============================================

Congratulations ${student.fullName || student.name || 'Candidate'}!

You have successfully qualified in the Winter Internship Merit Assessment.
Your merit scholarship coupon is ready:

Coupon Code:       ${coupon.code}
Student Payable:   ${payableText}
Expires At:        ${expiresAtFormatted} IST (Strictly 24 Hours)
Email Bound To:    ${student.email}

Enroll Now:
${enrollUrl}

Note: This coupon is valid for single use only and expires in 24 hours.

Plant Green Inertia Pvt. Ltd.
Maduravoyal, Chennai - 600095
`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendApplicationConfirmation(app) {
  const html = buildConfirmationEmailHtml(app);
  const text = buildConfirmationEmailText(app);
  const subject = `Application Confirmed: Plant Green Inertia Winter Internship [${app.applicationId}]`;

  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Plant Green Inertia <admissions@plantgreeninertia.com>',
          to: [app.email],
          subject,
          html,
          text
        })
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[Email] Resend delivery succeeded for ${app.email}: ${data.id}`);
        return { ok: true, provider: 'resend', id: data.id };
      }
    } catch (err) {
      console.error('[Email] Resend delivery failed:', err.message);
    }
  }

  console.log('----------------------------------------------------');
  console.log(`[Email Dispatched] To: ${app.email} | Subject: ${subject}`);
  console.log(`Application ID: ${app.applicationId} | Candidate: ${app.fullName}`);
  console.log('----------------------------------------------------');

  return { ok: true, provider: 'simulated', id: `sim-${Date.now()}` };
}

export async function sendCouponEmail(student, coupon) {
  const html = buildCouponEmailHtml(student, coupon);
  const text = buildCouponEmailText(student, coupon);
  const subject = `Scholarship Unlocked: Plant Green Inertia Winter Internship [${coupon.code}]`;

  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Plant Green Inertia <admissions@plantgreeninertia.com>',
          to: [student.email],
          subject,
          html,
          text
        })
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[Email] Resend coupon email succeeded for ${student.email}: ${data.id}`);
        return { ok: true, provider: 'resend', id: data.id };
      }
    } catch (err) {
      console.error('[Email] Resend coupon email failed:', err.message);
    }
  }

  console.log('----------------------------------------------------');
  console.log(`[Coupon Dispatched] To: ${student.email} | Code: ${coupon.code}`);
  console.log(`Discount: ${coupon.discount_percent}% | Expires: ${coupon.expires_at}`);
  console.log('----------------------------------------------------');

  return { ok: true, provider: 'simulated', id: `sim-coupon-${Date.now()}` };
}

export function buildEnrollmentReceiptEmailHtml(d) {
  const portalBase = (process.env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
  const dashUrl = `${portalBase}/portal.html`;
  const receiptUrl = d.receiptUrl || `${portalBase}/api/enrollments/${d.enrollmentId}/receipt.pdf`;
  const offerUrl = `${portalBase}/api/offer-letter`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Enrollment Confirmed &amp; Payment Receipt</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F5FAFF; margin: 0; padding: 20px; color: #101D35; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #D8E2EC; overflow: hidden; box-shadow: 0 4px 18px rgba(16,29,53,0.06); }
    .header { background: #101D35; padding: 28px 24px; text-align: center; color: #F5FAFF; }
    .header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 0; font-size: 13px; color: #B9DDF5; text-transform: uppercase; letter-spacing: 0.1em; }
    .content { padding: 30px 28px; line-height: 1.6; }
    .badge { display: inline-block; background: #296934; color: #ffffff; font-size: 13px; font-weight: 700; padding: 4px 12px; border-radius: 999px; }
    .cred-box { background: #F5FAFF; border: 1.5px solid #B9DDF5; border-radius: 10px; padding: 18px 20px; margin: 20px 0; }
    .cred-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #D8E2EC; font-size: 14px; }
    .cred-row:last-child { border-bottom: none; }
    .cred-lbl { font-weight: 700; color: #536B82; }
    .cred-val { font-weight: 800; color: #101D35; font-family: monospace; font-size: 15px; }
    .table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px; }
    .table td { padding: 8px 12px; border-bottom: 1px solid #EBF2F8; }
    .table td.lbl { color: #536B82; font-weight: 600; width: 40%; }
    .table td.val { color: #101D35; font-weight: 700; }
    .btn { display: inline-block; background: #296934; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 12px 24px; border-radius: 8px; margin: 6px; }
    .btn-alt { display: inline-block; background: #101D35; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 12px 24px; border-radius: 8px; margin: 6px; }
    .footer { background: #F5FAFF; padding: 20px 24px; text-align: center; font-size: 12px; color: #627D98; border-top: 1px solid #EBF2F8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Plant Green Inertia Pvt. Ltd.</h1>
      <p>Winter Internship &amp; Training Program 2026</p>
    </div>
    <div class="content">
      <div style="text-align:center;">
        <span class="badge">&#10003; PAYMENT VERIFIED &amp; ENROLLED</span>
      </div>
      <h2 style="color:#101D35;margin-top:14px;text-align:center;">Welcome to Plant Green Inertia!</h2>
      <p>Dear <strong>${escapeHtml(d.studentName)}</strong>,</p>
      <p>Your payment has been successfully captured and verified via Razorpay. Your enrollment in the Winter Internship and Training Program is officially confirmed.</p>

      <div class="cred-box">
        <h4 style="margin:0 0 10px;color:#101D35;font-size:14px;">YOUR STUDENT CREDENTIALS</h4>
        <div class="cred-row"><span class="cred-lbl">Student ID:</span><span class="cred-val">${escapeHtml(d.studentId)}</span></div>
        <div class="cred-row"><span class="cred-lbl">Registered Email:</span><span class="cred-val">${escapeHtml(d.email)}</span></div>
        ${d.password ? `<div class="cred-row"><span class="cred-lbl">Temporary Password:</span><span class="cred-val">${escapeHtml(d.password)}</span></div>` : ''}
      </div>

      <table class="table">
        <tr><td class="lbl">Enrolled Track:</td><td class="val">${escapeHtml(d.courseTitle)}</td></tr>
        <tr><td class="lbl">Cohort Duration:</td><td class="val">${escapeHtml(d.duration || '30 Hours (10 Days)')}</td></tr>
        <tr><td class="lbl">Receipt Number:</td><td class="val">${escapeHtml(d.receiptNo)}</td></tr>
        <tr><td class="lbl">Razorpay Payment ID:</td><td class="val"><code>${escapeHtml(d.transactionRef)}</code></td></tr>
        <tr><td class="lbl">Tuition Summary:</td><td class="val">₹10,000 (Fee) &minus; ₹9,001 (Scholarship) = <strong>₹999.00 PAID</strong></td></tr>
      </table>

      <div style="text-align:center;margin:24px 0;">
        <a class="btn" href="${receiptUrl}">Download Official Receipt (PDF)</a>
        <a class="btn-alt" href="${dashUrl}">Go to Student Dashboard &rarr;</a>
      </div>

      <p style="font-size:12.5px;color:#627D98;">
        <strong>Notice:</strong> Please save this email and your Student ID (<strong>${escapeHtml(d.studentId)}</strong>). Your onboarding schedule, mentor details, and live classroom links will be dispatched prior to cohort commencement.
      </p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Plant Green Inertia Pvt. Ltd.<br>
      No:4, 1st Floor, Alapakkam Main Road, Maduravoyal, Chennai - 600095<br>
      Email: plantgreeninertia@gmail.com | Phone: +91 82206 99083</p>
    </div>
  </div>
</body>
</html>`;
}

export function buildEnrollmentReceiptEmailText(d) {
  const portalBase = (process.env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
  const dashUrl = `${portalBase}/portal.html`;
  const receiptUrl = d.receiptUrl || `${portalBase}/api/enrollments/${d.enrollmentId}/receipt.pdf`;

  return `Plant Green Inertia - Enrollment Confirmed & Payment Receipt
============================================================

Dear ${d.studentName},

Your payment of ₹999.00 has been verified via Razorpay.
Your enrollment in the Winter Internship & Training Program is confirmed!

STUDENT CREDENTIALS:
-------------------
Student ID:        ${d.studentId}
Login Email:       ${d.email}
${d.password ? `Access Password:   ${d.password}\n` : ''}
ENROLLMENT & PAYMENT DETAILS:
----------------------------
Course Track:      ${d.courseTitle}
Duration:          ${d.duration || '30 Hours (10 Days)'}
Receipt Number:    ${d.receiptNo}
Transaction ID:    ${d.transactionRef}
Amount Paid:       ₹999.00 (Standard ₹10,000 fee with ₹9,001 merit scholarship)

Download Receipt (PDF):
${receiptUrl}

Student Dashboard:
${dashUrl}

Plant Green Inertia Pvt. Ltd.
Maduravoyal, Chennai - 600095
`;
}

export async function sendEnrollmentReceiptEmail(d) {
  const html = buildEnrollmentReceiptEmailHtml(d);
  const text = buildEnrollmentReceiptEmailText(d);
  const subject = `Enrollment Confirmed & Payment Receipt: Winter Internship 2026 [${d.studentId}]`;

  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Plant Green Inertia <admissions@plantgreeninertia.com>',
          to: [d.email],
          subject,
          html,
          text
        })
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[Email] Resend enrollment receipt email succeeded for ${d.email}: ${data.id}`);
        return { ok: true, provider: 'resend', id: data.id };
      }
    } catch (err) {
      console.error('[Email] Resend enrollment receipt email failed:', err.message);
    }
  }

  console.log('----------------------------------------------------');
  console.log(`[Receipt Dispatched] To: ${d.email} | Student ID: ${d.studentId}`);
  console.log(`Amount: ₹999 | Receipt No: ${d.receiptNo} | Txn: ${d.transactionRef}`);
  console.log('----------------------------------------------------');

  return { ok: true, provider: 'simulated', id: `sim-receipt-${Date.now()}` };
}

export function buildPasswordResetEmailHtml({ name, studentId, email, resetUrl }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Password Recovery - Plant Green Inertia</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F5FAFF; margin: 0; padding: 20px; color: #101D35; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #D8E2EC; overflow: hidden; box-shadow: 0 4px 18px rgba(16,29,53,0.06); }
    .header { background: #101D35; padding: 28px 24px; text-align: center; color: #F5FAFF; }
    .header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 0; font-size: 13px; color: #B9DDF5; text-transform: uppercase; letter-spacing: 0.1em; }
    .content { padding: 30px 28px; line-height: 1.6; }
    .btn { display: inline-block; background: #296934; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 8px; margin: 20px 0; }
    .cred-box { background: #F5FAFF; border: 1px solid #D8E2EC; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13.5px; }
    .footer { background: #F5FAFF; padding: 20px 24px; text-align: center; font-size: 12px; color: #627D98; border-top: 1px solid #EBF2F8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Plant Green Inertia Pvt. Ltd.</h1>
      <p>Student Portal Security</p>
    </div>
    <div class="content">
      <h2>Password Recovery Request</h2>
      <p>Hello <strong>${escapeHtml(name || 'Candidate')}</strong>,</p>
      <p>We received a request to reset your password for the Plant Green Inertia Student Portal.</p>
      <div class="cred-box">
        ${studentId ? `<strong>Student ID:</strong> ${escapeHtml(studentId)}<br>` : ''}
        <strong>Registered Email:</strong> ${escapeHtml(email)}
      </div>
      <p>Click the secure button below to set a new password. This link expires in 1 hour.</p>
      <div style="text-align:center;">
        <a class="btn" href="${resetUrl}">Reset My Password &rarr;</a>
      </div>
      <p style="font-size:12px;color:#627D98;">If you did not request this password reset, please disregard this email or contact support.</p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Plant Green Inertia Pvt. Ltd.<br>Maduravoyal, Chennai - 600095</p>
    </div>
  </div>
</body>
</html>`;
}

export function buildPasswordResetEmailText({ name, studentId, email, resetUrl }) {
  return `Plant Green Inertia - Password Recovery
============================================================

Hello ${name || 'Candidate'},

We received a request to reset your password for the Plant Green Inertia Student Portal.
${studentId ? `Student ID: ${studentId}\n` : ''}Registered Email: ${email}

Use the link below to set your new password (valid for 1 hour):
${resetUrl}

If you did not make this request, you can safely ignore this email.

Plant Green Inertia Pvt. Ltd.
Maduravoyal, Chennai - 600095
`;
}

export async function sendPasswordResetEmail(d) {
  const html = buildPasswordResetEmailHtml(d);
  const text = buildPasswordResetEmailText(d);
  const subject = `Password Recovery: Plant Green Inertia Student Portal`;

  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Plant Green Inertia <admissions@plantgreeninertia.com>',
          to: [d.email],
          subject,
          html,
          text
        })
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, provider: 'resend', id: data.id };
      }
    } catch (err) {
      console.error('[Email] Resend password reset email failed:', err.message);
    }
  }

  console.log('----------------------------------------------------');
  console.log(`[Password Reset Email] To: ${d.email} | Link: ${d.resetUrl}`);
  console.log('----------------------------------------------------');
  return { ok: true, provider: 'simulated', id: `sim-reset-${Date.now()}` };
}
