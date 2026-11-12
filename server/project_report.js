import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtDate } from './report.js';

const D = path.dirname(fileURLToPath(import.meta.url));
const A = f => path.join(D, 'assets', f);
const FNT = f => path.join(D, 'fonts', f);
const LEFT = 64;
const W = 612 - 2 * LEFT; // 484
const TOP = 160;

export const reportDocId = (studentId, seq) => seq || ('REP-PGI-W26-' + String(studentId || 'STUDENT').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase());

const DOMAIN_PROJECT_PROFILES = [
  {
    id: 'operations',
    match: ['operation', 'agile', 'scrum', 'project management'],
    domainType: 'Non-Technical',
    projectTitle: 'Enterprise Digital Operations Workflow & Agile Sprint Governance Framework',
    abstract:
      'Conceptualized and executed during the 30-hour Plant Green Inertia Winter Internship Program, this capstone establishes an end-to-end Agile Scrum and digital operations framework. The solution standardizes sprint backlog prioritization, SLA tracking, cross-functional handoffs, and executive KPI reporting to eliminate workflow bottlenecks and improve delivery predictability.',
    problemStatement:
      'Unstructured task prioritization, ambiguous ownership across cross-functional squads, and manual status reporting create recurring SLA breaches and unpredictable sprint velocity across digital service teams.',
    architecture:
      'Designed an operational governance pipeline combining MoSCoW & RICE backlog scoring, Kanban WIP limits, RACI ownership matrices, automated status escalation rules, and sprint burndown telemetry.',
    technologies: [
      'Agile & Scrum Lifecycle',
      'Sprint Backlog Governance',
      'Jira & Kanban Workflows',
      'RACI Ownership Matrix',
      'SOP Process Engineering',
      'SLA & Velocity KPI Dashboards',
      'Root-Cause Quality Auditing'
    ],
    methodologies: [
      'Structured a 10-day Agile delivery roadmap incorporating MoSCoW prioritization, story-point estimation, and sprint capacity planning.',
      'Authored cross-functional RACI responsibility matrices and standardized SOP checklists to cut handoff latency across service queues.',
      'Executed cycle-time tracking, bottleneck root-cause analysis (RCA), and milestone burndown reviews with cohort mentor sign-off.'
    ],
    outcomes: [
      'Production-ready Agile sprint & Kanban operational governance playbook.',
      'Quantifiable SLA compliance, cycle-time, and velocity KPI tracking templates.',
      'Verified capstone review defended under 30-hour Winter Cohort specifications.'
    ]
  },
  {
    id: 'business-analysis',
    match: ['business', 'analysis', 'analytics', 'communication', 'brd'],
    domainType: 'Non-Technical',
    projectTitle: 'Enterprise Business Requirements Dossier & Executive KPI Decision System',
    abstract:
      'Designed and validated during the 30-hour Plant Green Inertia Winter Internship Program, this capstone translates strategic business objectives into formal Business Requirement Documents (BRDs), Functional Requirement Specifications (FRSs), process flow architectures, interactive wireframes, and executive KPI analytics models.',
    problemStatement:
      'Misalignment between stakeholder business goals and technical implementation teams frequently introduces requirement ambiguity, scope creep, and costly rework late in the software delivery cycle.',
    architecture:
      'Established a complete Business Analysis lifecycle linking stakeholder discovery, AS-IS / TO-BE process mapping, Requirement Traceability Matrices (RTM), wireframe prototyping, and spreadsheet funnel sensitivity models.',
    technologies: [
      'BRD & FRD Authoring',
      'Requirement Traceability (RTM)',
      'AS-IS / TO-BE Process Flowcharts',
      'UI/UX Wireframing',
      'Spreadsheet KPI & Funnel Modeling',
      'User Stories & Acceptance Criteria',
      'Executive Stakeholder Communication'
    ],
    methodologies: [
      'Translated business objectives into testable user stories with explicit Given-When-Then acceptance criteria and prioritization scoring.',
      'Constructed AS-IS vs. TO-BE process diagrams and traceability matrices connecting every business goal to verifiable deliverables.',
      'Built analytical KPI dashboards evaluating funnel conversion, cost-benefit projections, and operational feasibility risks.'
    ],
    outcomes: [
      'Signed-off BRD / FRS dossier paired with a complete Requirement Traceability Matrix.',
      'Executive KPI spreadsheet model & annotated low-fidelity screen wireframes.',
      'Technical stakeholder briefing validated against 30-hour cohort benchmarks.'
    ]
  },
  {
    id: 'marketing',
    match: ['marketing', 'growth', 'seo', 'brand'],
    domainType: 'Non-Technical',
    projectTitle: 'Omnichannel Digital Growth Funnel, SEO Architecture & Acquisition Campaign Blueprint',
    abstract:
      'Engineered during the 30-hour Plant Green Inertia Winter Internship Program, this capstone builds a full-funnel customer acquisition engine spanning technical SEO audits, TOFU/MOFU/BOFU content pipelines, paid campaign budgeting (ROAS & CAC modeling), CRM email nurturing automation, and GA4 attribution analytics.',
    problemStatement:
      'Rising acquisition costs and fragmented channel tracking limit campaign ROI when organic search optimization, paid media targeting, and conversion analytics operate without unified attribution.',
    architecture:
      'Architected a measurable growth pipeline uniting search-intent keyword clustering, UTM-instrumented conversion tracking, A/B landing page experimentation, lifecycle drip automation, and funnel reporting.',
    technologies: [
      'Technical & On-Page SEO',
      'TOFU / MOFU / BOFU Funnels',
      'Google Analytics 4 & UTM Tracking',
      'Meta Ads & Search Campaigns',
      'Email Drip & CRM Automation',
      'Conversion Copywriting & A/B Tests',
      'Competitor SWOT & ROAS Modeling'
    ],
    methodologies: [
      'Performed technical SEO audits and search-intent keyword clustering to capture high-intent organic acquisition opportunities.',
      'Designed multi-stage content calendars, conversion landing copy, and automated lead-nurturing email drip sequences.',
      'Modeled campaign economics (CTR, CPC, CAC, ROAS) with standardized UTM taxonomy and structured A/B experiment matrices.'
    ],
    outcomes: [
      'Full-funnel acquisition strategy & 10-module growth execution calendar.',
      'Instrumented UTM attribution schema and campaign unit-economics workbook.',
      'Verified campaign pitch presented to Plant Green Inertia growth mentors.'
    ]
  },
  {
    id: 'mobile',
    match: ['mobile', 'app development', 'android', 'app inventor'],
    domainType: 'Technical',
    projectTitle: 'Cross-Platform Android Utility & Real-Time Cloud Sync Mobile Application',
    abstract:
      'Designed and built during the 30-hour Plant Green Inertia Winter Internship Program, this capstone delivers an interactive Android mobile application featuring modular visual event logic, persistent offline TinyDB and CloudDB synchronization, hardware sensor integration, responsive touch layouts, and signed APK packaging.',
    problemStatement:
      'Mobile-first field users require lightweight, offline-resilient Android applications capable of capturing device sensor inputs reliably and synchronizing state with cloud REST services on intermittent networks.',
    architecture:
      'Implemented an event-driven multi-screen Android architecture separating touch UI components, local TinyDB offline caching, HTTPS JSON cloud synchronization, runtime permission checks, and lifecycle state handlers.',
    technologies: [
      'Mobile UI/UX Design Patterns',
      'MIT App Inventor & Logic Blocks',
      'Android Lifecycle & Permissions',
      'TinyDB & CloudDB Persistence',
      'RESTful JSON API Integration',
      'Hardware Sensors (GPS / Camera)',
      'Signed APK Compilation & QA'
    ],
    methodologies: [
      'Architected responsive mobile interfaces following ergonomic touch-target sizing, screen-density adaptation, and clean navigation stacks.',
      'Built event-driven state handlers with offline local TinyDB storage paired with live HTTPS RESTful API cloud synchronization.',
      'Verified runtime permission sandboxing, GPS/camera sensor bindings, and on-device debugging via structured QA scenarios.'
    ],
    outcomes: [
      'Installable Android APK build verified across target viewport form factors.',
      'Resilient offline-first persistence integrated with live cloud API sync.',
      'Passed technical mentor functionality audit for 30-hour cohort completion.'
    ]
  },
  {
    id: 'web',
    match: ['web', 'full-stack', 'cloud', 'html', 'javascript'],
    domainType: 'Technical',
    projectTitle: 'Full-Stack Responsive Web Platform & Automated Cloud Service Portal',
    abstract:
      'Conceptualized and engineered during the 30-hour Plant Green Inertia Winter Internship Program, this capstone implements a production-ready web application featuring semantic HTML5 views, responsive CSS3 design systems, modular ES6+ client workflows, RESTful backend APIs, and transactional relational persistence.',
    problemStatement:
      'Modern digital service portals demand accessible, mobile-responsive frontend experiences backed by authoritative server validation, relational data integrity, and reproducible cloud deployment pipelines.',
    architecture:
      'Engineered a decoupled client-server web architecture pairing fluid CSS Grid/Flexbox interfaces and token-authenticated Fetch pipelines with Node.js/Express controllers, relational schema constraints, and automated verification.',
    technologies: [
      'HTML5 Semantic Standards',
      'CSS3 Flexbox, Grid & Tokens',
      'Modern JavaScript (ES6+)',
      'Node.js & Express REST APIs',
      'PostgreSQL / Supabase DB',
      'Git & GitHub CI Workflows',
      'Cloud Hosting & Automated Tests'
    ],
    methodologies: [
      'Engineered responsive, accessible frontend components following structured corporate typography, grid hierarchies, and mobile breakpoints.',
      'Implemented transactional REST endpoints, input validation middleware, relational schema constraints, and automated state auditing.',
      'Maintained clean Git pull-request workflows alongside automated unit checks and production cloud readiness verification.'
    ],
    outcomes: [
      'Responsive production web application validated across desktop and mobile viewports.',
      'End-to-end authenticated API and relational persistence layer verified by tests.',
      'Audited source repository approved for 30-hour Winter Cohort certification.'
    ]
  }
];

export function resolveDomainProjectProfile(domainName, domainType) {
  const norm = String(domainName || '').trim().toLowerCase();
  const matched = DOMAIN_PROJECT_PROFILES.find(p => p.match.some(kw => norm.includes(kw)));
  if (matched) return matched;
  const isNonTech = String(domainType || '').trim().toLowerCase() === 'non-technical';
  return DOMAIN_PROJECT_PROFILES.find(p => p.id === (isNonTech ? 'operations' : 'web'));
}

function formatModeLabel(mode) {
  const raw = String(mode || 'Online').trim() || 'Online';
  return /\(\s*\d+\s*hours?\s*\)/i.test(raw) ? raw : `${raw} (30 Hours)`;
}

function formatListText(val) {
  if (Array.isArray(val)) return val.map(v => String(v || '').trim()).filter(Boolean).join(' · ');
  return String(val || '').trim();
}

/**
 * Builds the complimentary 1-Page Official Internship Project Report PDF
 * tailored strictly to the student's chosen domain track.
 * @param {Object} data - Project report data
 * @returns {Promise<Buffer>} PDF Buffer
 */
export function buildProjectReportPDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: TOP, bottom: 52, left: LEFT, right: LEFT },
      info: {
        Title: 'Official Internship Project Report - ' + (data.studentId || 'PGI'),
        Author: 'Plant Green Inertia Pvt. Ltd.'
      }
    });

    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    doc.registerFont('R', FNT('FreeSerif.ttf'));
    doc.registerFont('B', FNT('FreeSerif-Bold.ttf'));

    const addLetterhead = () => {
      try {
        doc.image(A('header.png'), 0, 0, { width: 612 });
      } catch {}
      try {
        doc.image(A('footer.png'), 0, 792 - (612 * 111 / 1700) - 14, { width: 612 });
      } catch {}
      doc.x = LEFT;
      doc.y = TOP;
    };

    addLetterhead();

    const domainTitle = data.courseTitle || data.domainName || 'Winter Internship Track';
    const profile = resolveDomainProjectProfile(domainTitle, data.domainType);
    const domainTypeLabel = data.domainType || profile.domainType || 'Technical';
    const projTitle = data.projectTitle || data.title || profile.projectTitle;
    const abstractText = data.abstract || profile.abstract;
    const problemText = data.problemStatement || profile.problemStatement;
    const archText = data.architecture || profile.architecture;
    const techList = formatListText(data.technologies) || profile.technologies.join(' · ');
    const bullets = Array.isArray(data.methodologies) && data.methodologies.length
      ? data.methodologies.slice(0, 3)
      : profile.methodologies;
    const outcomes = Array.isArray(data.outcomes) && data.outcomes.length
      ? data.outcomes.slice(0, 3)
      : profile.outcomes;

    // Document Title & Subtitle
    doc.font('B').fontSize(14.5).fillColor('#101D35').text('OFFICIAL INTERNSHIP PROJECT REPORT', LEFT, TOP, { align: 'center', width: W });
    doc.font('R').fontSize(8.8).fillColor('#536B82').text(`Plant Green Inertia Pvt. Ltd. · Winter Internship Program 2026 · ${domainTypeLabel} Track`, { align: 'center', width: W });
    doc.y += 7;

    const repNo = data.reportId || data.documentId || reportDocId(data.studentId);
    const metaY = doc.y;
    doc.rect(LEFT, metaY, W, 36).fillAndStroke('#F5FAFF', '#D8E2EC');

    doc.font('B').fontSize(8).fillColor('#101D35').text('DOCUMENT ID:', LEFT + 12, metaY + 6);
    doc.font('B').fontSize(9.2).fillColor('#296934').text(repNo, LEFT + 12, metaY + 18);

    doc.font('B').fontSize(8).fillColor('#101D35').text('COMPLETION DATE:', LEFT + 175, metaY + 6);
    doc.font('R').fontSize(9).fillColor('#101D35').text(fmtDate(data.date || new Date()), LEFT + 175, metaY + 18);

    doc.font('B').fontSize(8).fillColor('#101D35').text('EVALUATION GRADE:', LEFT + 335, metaY + 6);
    doc.font('B').fontSize(9.2).fillColor('#296934').text('GRADE A (EXEMPLARY)', LEFT + 335, metaY + 18);

    doc.y = metaY + 44;

    // Candidate & Cohort Credentials (3 clean two-column rows)
    doc.font('B').fontSize(10).fillColor('#101D35').text('CANDIDATE & COHORT CREDENTIALS', LEFT, doc.y);
    doc.y += 2;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + W, doc.y).strokeColor('#296934').lineWidth(1.1).stroke();
    doc.y += 5;

    const drawCredRow = (lLabel, lVal, rLabel, rVal, boldLeft = false, greenRight = false) => {
      const y = doc.y;
      doc.font('B').fontSize(8.5).fillColor('#536B82').text(lLabel, LEFT, y, { width: 82, lineBreak: false });
      doc.font(boldLeft ? 'B' : 'R').fontSize(8.5).fillColor('#101D35').text(String(lVal || '-'), LEFT + 84, y, { width: 170, height: 12, ellipsis: true });
      doc.font('B').fontSize(8.5).fillColor('#536B82').text(rLabel, LEFT + 264, y, { width: 76, lineBreak: false });
      doc.font(greenRight ? 'B' : 'R').fontSize(8.5).fillColor(greenRight ? '#296934' : '#101D35').text(String(rVal || '-'), LEFT + 342, y, { width: W - 342, height: 12, ellipsis: true });
      doc.y = y + 14;
    };

    const rawInst = [data.college, data.department].filter(Boolean).join(' · ');
    const instStr = rawInst.length > 36 && data.college ? data.college : (rawInst || 'Plant Green Inertia Cohort Fellow');
    drawCredRow('Candidate Name:', data.name || '-', 'Student ID:', data.studentId || '-', true, true);
    drawCredRow('Domain Track:', domainTitle, 'Training Mode:', formatModeLabel(data.mode));
    drawCredRow('Institution:', instStr, 'Faculty Mentor:', data.mentorName || 'PGI Academic Team');

    doc.y += 5;

    // Capstone Project Specification
    doc.font('B').fontSize(10).fillColor('#101D35').text('CAPSTONE PROJECT SPECIFICATION', LEFT, doc.y);
    doc.y += 2;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + W, doc.y).strokeColor('#296934').lineWidth(1.1).stroke();
    doc.y += 6;

    // Highlighted Project Title Card
    const titleBoxY = doc.y;
    const titleStr = `Project Title: ${projTitle}`;
    doc.font('B').fontSize(9.5);
    const titleH = Math.max(26, doc.heightOfString(titleStr, { width: W - 22 }) + 12);
    doc.rect(LEFT, titleBoxY, W, titleH).fillAndStroke('#F5FAFF', '#D8E2EC');
    doc.rect(LEFT, titleBoxY, 3.5, titleH).fill('#296934');
    doc.font('B').fontSize(9.5).fillColor('#101D35').text(titleStr, LEFT + 12, titleBoxY + 6, { width: W - 22 });
    doc.y = titleBoxY + titleH + 8;

    const addSectionParagraph = (heading, body) => {
      doc.font('B').fontSize(8.8).fillColor('#101D35').text(heading, LEFT, doc.y);
      doc.y += 1.5;
      doc.font('R').fontSize(8.2).fillColor('#1E293B').text(body, LEFT, doc.y, { width: W, lineGap: 1.2 });
      doc.y += 6;
    };

    addSectionParagraph('1. Executive Abstract', abstractText);
    addSectionParagraph('2. Problem Statement & Scope', problemText);
    addSectionParagraph('3. Solution Architecture & Operational Workflow', archText);
    addSectionParagraph('4. Core Tools, Frameworks & Competencies Utilized', techList);

    // Section 5: Key Methodologies & Milestones
    doc.font('B').fontSize(8.8).fillColor('#101D35').text('5. Key Methodologies & Executed Milestones', LEFT, doc.y);
    doc.y += 2.5;
    bullets.forEach(b => {
      const by = doc.y;
      doc.font('B').fontSize(8.2).fillColor('#296934').text('•', LEFT + 8, by, { lineBreak: false });
      doc.font('R').fontSize(8.2).fillColor('#1E293B').text(b, LEFT + 18, by, { width: W - 20, lineGap: 1 });
      doc.y += 2;
    });
    doc.y += 4;

    // Section 6: Verified Outcomes & Deliverables
    doc.font('B').fontSize(8.8).fillColor('#101D35').text('6. Verified Deliverables & Capstone Outcomes', LEFT, doc.y);
    doc.y += 2.5;
    outcomes.forEach(o => {
      const oy = doc.y;
      doc.font('B').fontSize(8.2).fillColor('#296934').text('•', LEFT + 8, oy, { lineBreak: false });
      doc.font('R').fontSize(8.2).fillColor('#1E293B').text(o, LEFT + 18, oy, { width: W - 20, lineGap: 1 });
      doc.y += 2;
    });

    // Anchored Verification Seal Card (keeps report strictly single-page and fills page cleanly)
    const sealY = Math.min(Math.max(doc.y + 8, 668), 676);
    doc.rect(LEFT, sealY, W, 46).fillAndStroke('#F5FAFF', '#D8E2EC');
    doc.rect(LEFT, sealY, 3.5, 46).fill('#101D35');

    doc.font('B').fontSize(8.3).fillColor('#296934').text('OFFICIAL ACADEMIC VERIFICATION & ENDORSEMENT', LEFT + 12, sealY + 7);
    doc.font('R').fontSize(7.6).fillColor('#536B82').text(
      `This 1-page capstone project report is an authentic record of the ${domainTitle} capstone completed under mentorship at Plant Green Inertia Pvt. Ltd., ` +
      'Official Training Partner of TN Skills, TNSDC. Validated for institutional academic credit.',
      LEFT + 12, sealY + 19, { width: W - 22, lineGap: 1 }
    );

    doc.end();
  });
}
