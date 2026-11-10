import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfirmationEmailHtml, buildConfirmationEmailText } from '../email.js';
import { parseDobCredentials, normalizeLoginPassword } from '../logic.js';

test('application email template generation', () => {
  const sampleApp = {
    applicationId: 'PGI-W26-0001',
    fullName: 'Ananya Sharma',
    email: 'ananya@example.com',
    phone: '+91 98765 43210',
    college: 'Anna University',
    department: 'Computer Science & Engineering',
    passedOutYear: '2026',
    domainType: 'Technical',
    domainName: 'Web Development & Cloud Deployment',
    mode: 'Online',
    duration: '30 Hours',
    internshipPeriod: '1 month',
    address: 'Chennai, Tamil Nadu',
    whyHire: 'Passionate about building responsive full-stack applications and eager to learn.',
    referralCode: 'founder'
  };

  const html = buildConfirmationEmailHtml(sampleApp);
  assert.ok(html.includes('PGI-W26-0001'));
  assert.ok(html.includes('Ananya Sharma'));
  assert.ok(html.includes('Web Development &amp; Cloud Deployment'));
  assert.ok(html.includes('founder'));
  assert.ok(html.includes('4:00 PM – 6:00 PM IST'));

  const text = buildConfirmationEmailText(sampleApp);
  assert.ok(text.includes('PGI-W26-0001'));
  assert.ok(text.includes('Ananya Sharma'));
  assert.ok(text.includes('founder'));
});

test('phone normalization for 10-digit mobile', () => {
  const norm = p => String(p || '').replace(/\D/g, '').slice(-10);
  assert.equal(norm('+91 9876543210'), '9876543210');
  assert.equal(norm('098765-43210'), '9876543210');
  assert.equal(norm('9876543210'), '9876543210');
  assert.equal(norm('123'), '123'); // invalid length check
});

test('application ID formatting', () => {
  const formatAppId = seq => `PGI-W26-${String(seq).padStart(4, '0')}`;
  assert.equal(formatAppId(1), 'PGI-W26-0001');
  assert.equal(formatAppId(42), 'PGI-W26-0042');
  assert.equal(formatAppId(999), 'PGI-W26-0999');
  assert.equal(formatAppId(1024), 'PGI-W26-1024');
});

test('parseDobCredentials normalizes ISO and DD-MM-YYYY dates into DDMMYYYY password', () => {
  assert.deepEqual(parseDobCredentials('2004-08-15'), {
    dobIso: '2004-08-15',
    password: '15082004'
  });
  assert.deepEqual(parseDobCredentials('05-01-2003'), {
    dobIso: '2003-01-05',
    password: '05012003'
  });
  assert.equal(parseDobCredentials('2004-02-30'), null);
  assert.equal(parseDobCredentials('1950-01-01'), null);
  assert.equal(parseDobCredentials('2022-05-10'), null);
  assert.equal(parseDobCredentials(''), null);
});

test('confirmation email includes DOB login credentials when password is provided', () => {
  const appWithPw = {
    applicationId: 'PGI-W26-0099',
    fullName: 'Karthik Rao',
    email: 'karthik@example.com',
    phone: '+91 98765 00000',
    college: 'NIT Trichy',
    department: 'ECE',
    passedOutYear: '2026',
    domainType: 'Technical',
    domainName: 'AI & Machine Learning',
    mode: 'Online',
    duration: '30 Hours',
    internshipPeriod: '1 month',
    address: 'Trichy, Tamil Nadu',
    password: '15082004'
  };

  const html = buildConfirmationEmailHtml(appWithPw);
  assert.ok(html.includes('karthik@example.com'));
  assert.ok(html.includes('15082004'));
  assert.ok(html.includes('Password (DOB'));
  assert.ok(html.includes('portal.html?mode=login'));

  const text = buildConfirmationEmailText(appWithPw);
  assert.ok(text.includes('karthik@example.com'));
  assert.ok(text.includes('15082004'));
  assert.ok(text.includes('Password (DOB'));
  assert.ok(text.includes('portal.html?mode=login'));
});

test('normalizeLoginPassword converts DD/MM/YYYY variations to DDMMYYYY while preserving standard passwords', () => {
  assert.equal(normalizeLoginPassword('15/08/2004'), '15082004');
  assert.equal(normalizeLoginPassword('15 / 08 / 2004'), '15082004');
  assert.equal(normalizeLoginPassword('05-01-2003'), '05012003');
  assert.equal(normalizeLoginPassword('15082004'), '15082004');
  assert.equal(normalizeLoginPassword('MyCustomPass#2026'), 'MyCustomPass#2026');
});
