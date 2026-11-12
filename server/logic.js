import crypto from 'node:crypto';
export const BASE_PRICE_PAISE = 999900; // Legacy base price (Diwali)
export const WINTER_PRICE_PAISE = 1000000; // ₹10,000 for Winter Internship Program
export const TEST_COUPON_CODE = 'PGITEST1';
export const TEST_COUPON_PAISE = 100; // ₹1 (100 paise)

export function isTestCouponEnabled() {
  return String(process.env.ENABLE_TEST_COUPON || '').trim().toLowerCase() === 'true';
}

export function isTestCoupon(c) {
  if (!c) return false;
  return Boolean(
    c.is_test === true ||
    c.isTest === true ||
    String(c.code || '').trim().toUpperCase() === TEST_COUPON_CODE
  );
}

// Integer-only tier calc. correct/total compared via cross-multiplication (no floats).
export function tierFor(correct, total) {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0 || correct < 0 || correct > total) throw new Error('invalid score');
  return correct * 100 >= total * 50 ? 90 : 85;
}

export function payablePaise(basePaise, discountPercent) {
  if (![0, 85, 88, 90].includes(discountPercent)) throw new Error('invalid tier');
  if (!Number.isInteger(basePaise) || basePaise < 0) throw new Error('invalid price');
  if (discountPercent === 0) return basePaise;
  // Winter Internship: ₹9,999/₹10,000 base -> 88% tier = ₹1,199, 90% tier = ₹999
  if (discountPercent === 88 && (basePaise === 999900 || basePaise === 1000000)) return 119900;
  if (basePaise === 1000000 && discountPercent === 90) return 99900;
  // integer half-up rounding; for legacy 999900 base this is exact (149985 / 99990)
  return Math.floor((basePaise * (100 - discountPercent) + 50) / 100);
}

// Winter Cohort tiers: 0–3 correct out of 25 (0%–12%) -> ₹1,199 (88% grant); 4–25 (16%–100%) -> ₹999 (90% grant).
export function winterTierFor(correct, total) {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0 || correct < 0 || correct > total) throw new Error('invalid score');
  return correct * 100 <= total * 12 ? 88 : 90;
}

export function winterPayablePaise(coupon) {
  if (!coupon) return BASE_PRICE_PAISE; // ₹9,999 (999900 paise) default when no coupon is applied
  if (isTestCoupon(coupon)) {
    const fixed = coupon.fixed_payable_paise ?? coupon.fixedPayablePaise;
    return fixed !== null && fixed !== undefined && Number.isFinite(Number(fixed))
      ? Number(fixed)
      : TEST_COUPON_PAISE;
  }
  const disc = Number(coupon.discount_percent ?? coupon.discountPercent);
  if (disc === 90 || disc === 100) return 99900;
  if (disc === 88 || disc === 85) return 119900;
  return BASE_PRICE_PAISE;
}

export const formatINR = p => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function scorePercent(correct, total) { return Math.round((correct * 10000) / total) / 100; }
export function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Draw `count` distinct questions for ONE student, mixing all question sets at random.
// Each pick chooses a random set (never the same set twice in a row while another set has questions left),
// then a random unused question from it. Questions the student saw in earlier attempts are skipped when enough unseen remain.
const qKey = q => (q.text ? String(q.text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '') || q.id;
function mixSets(list, count) { // random set per pick, never the same set twice in a row while another set has questions left
  const bySet = new Map();
  for (const q of list) { const k = q.question_set ?? 1; if (!bySet.has(k)) bySet.set(k, []); bySet.get(k).push(q); }
  const queues = [...bySet.values()].map(shuffle), out = []; let last = -1;
  while (out.length < count && queues.some(q => q.length)) {
    const live = queues.map((_, i) => i).filter(i => queues[i].length), cand = live.filter(i => i !== last), from = cand.length ? cand : live;
    last = from[crypto.randomInt(from.length)]; out.push(queues[last].pop());
  }
  return out;
}

// Questions are unique by id AND by wording (the same text stored twice counts once). Questions the student saw before
// (by id or wording) are used last, only when too few unseen questions remain.
export function pickQuestions(pool, count, seen = new Set()) {
  const byKey = new Map(); for (const q of pool) if (!byKey.has(qKey(q))) byKey.set(qKey(q), q);
  const seenKeys = new Set(pool.filter(q => seen.has(q.id)).map(qKey)), uniq = [...byKey.values()];
  const fresh = uniq.filter(q => !seen.has(q.id) && !seenKeys.has(qKey(q)));
  const out = mixSets(fresh, count);
  if (out.length < count) out.push(...mixSets(uniq.filter(q => !out.includes(q)), count - out.length));
  return out;
}

export function makeCouponCode(prefix = 'WIN-') {
  return prefix + crypto.randomBytes(3).toString('hex').toUpperCase();
}

export function couponState(c, now = new Date()) {
  if (!c) return 'none';
  if (c.status === 'revoked' || c.status === 'disabled') return c.status;
  if (!isTestCoupon(c) && !c.is_reusable && c.status === 'redeemed') return 'redeemed';
  if (!c.expires_at) return 'active';
  return new Date(c.expires_at) <= now ? 'expired' : 'active';
}

export function canRequestExtension(c, maxExtensions = 2) {
  if (!c) return false;
  if (isTestCoupon(c) || c.is_reusable) return false;
  if (c.status === 'redeemed' || c.status === 'revoked' || c.status === 'disabled') return false;
  return (Number(c.extension_count) || 0) < maxExtensions;
}

export function validateAnswer(b) {
  if (!b || typeof b.questionId !== 'string' || typeof b.optionId !== 'string' || b.optionId.length > 64) throw new Error('bad input');
}

/**
 * Server-side score calculator
 * Supports total_marks 100, pass_mark 30 (default), optional negative marking,
 * and individual question marks.
 */
export function calculateAssessmentScore({
  responses = [],
  questions = [],
  marksPerQuestion = 5,
  negativeMarking = 0,
  totalMarks = 100,
  passMark = 30
}) {
  const key = new Map(questions.map(q => [q.id, {
    correct: q.correct_option_id,
    marks: Number(q.marks) || marksPerQuestion
  }]));

  let rawScore = 0;
  let correctCount = 0;
  let wrongCount = 0;

  for (const r of responses) {
    const qInfo = key.get(r.question_id);
    if (!qInfo) continue;
    if (r.selected_option_id === qInfo.correct) {
      rawScore += qInfo.marks;
      correctCount++;
    } else if (r.selected_option_id) {
      rawScore -= (Number(negativeMarking) || 0);
      wrongCount++;
    }
  }

  const finalScore = Math.max(0, Math.min(totalMarks, Math.round(rawScore * 100) / 100));
  const scorePct = totalMarks > 0 ? Math.round((finalScore / totalMarks) * 10000) / 100 : 0;
  const isQualified = finalScore >= passMark;

  return {
    score: finalScore,
    totalMarks,
    passMark,
    correctCount,
    wrongCount,
    totalQuestions: questions.length,
    scorePercent: scorePct,
    isQualified
  };
}

// ---- Proctoring policy: 3 warnings, the 4th counted violation auto-submits ----
export const MAX_WARNINGS = 3, DEDUPE_MS = 5000;
export const VIOLATION_LABELS = {
  multiple_faces: 'More than one person detected', no_face: 'Face not visible', looking_away: 'Head turned away from the screen',
  face_mismatch: 'Face does not match the verified candidate', camera_unavailable: 'Camera unavailable or switched off', phone_detected: 'Phone detected',
  tab_switch: 'Left the test tab or window', fullscreen_exit: 'Exited full-screen mode', copy_paste: 'Copy / paste attempt', blocked_shortcut: 'Blocked keyboard shortcut (print / developer tools / save)',
  looking_down: 'Looked down for a long time (possible phone or notes)', noise_detected: 'Voices or loud noise detected' };
export const VIOLATION_TYPES = Object.keys(VIOLATION_LABELS);
// Advisory events are logged (with a snapshot) for admin review but never count toward the 3 warnings or auto-submit: they are too easy to trigger innocently.
export const ADVISORY_TYPES = ['looking_down', 'noise_detected'], MAX_SNAPSHOTS = 8, ADVISORY_GAP_MS = 30000;
// Accept only a small base64 JPEG data URL; anything else is dropped (the violation is still recorded).
export const cleanSnapshot = s => typeof s === 'string' && s.length < 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null;
// A burst of events within DEDUPE_MS (e.g. one Alt-Tab firing blur + visibility + fullscreen) counts once.
export function violationDecision(countedSoFar, lastCountedAt, now = Date.now()) {
  const counted = !(lastCountedAt && now - new Date(lastCountedAt).getTime() < DEDUPE_MS);
  const total = countedSoFar + (counted ? 1 : 0);
  return { counted, total, warningsLeft: Math.max(0, MAX_WARNINGS - total), autoSubmit: total > MAX_WARNINGS };
}
export const STATUS_TEXT = { submitted: 'Submitted by candidate', timed_out: 'Auto-submitted: time elapsed', auto_submitted: 'Auto-submitted: proctoring violation limit exceeded', in_progress: 'In progress' };

/**
 * Normalizes a Date of Birth string (YYYY-MM-DD or DD-MM-YYYY) to ISO YYYY-MM-DD
 * and derives the 8-character assessment login password in DDMMYYYY format.
 */
export function parseDobCredentials(rawDob) {
  const s = String(rawDob || '').trim();
  let year, month, day;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  } else {
    m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) {
      day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
    }
  }

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1960 || year > new Date().getFullYear() - 12) return null;

  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    return null;
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    dobIso: `${year}-${mm}-${dd}`,
    password: `${dd}${mm}${year}`
  };
}

/**
 * Normalizes a DOB-formatted login key (e.g. "15/08/2004", "15 / 08 / 2004", "15-08-2004")
 * to 8-character DDMMYYYY while preserving arbitrary non-DOB passwords untouched.
 */
export function normalizeLoginPassword(rawPw) {
  const raw = String(rawPw || '');
  const m = raw.trim().match(/^(\d{2})\s*[/-]\s*(\d{2})\s*[/-]\s*(\d{4})$/);
  if (!m) return raw;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return raw;
  return `${m[1]}${m[2]}${m[3]}`;
}

function buildTrackModules(days) {
  return days.map((m, idx) => {
    if (Array.isArray(m)) {
      return { day: idx + 1, hours: 3, title: m[0], topics: m[1] };
    }
    return {
      day: idx + 1,
      hours: 3,
      title: m.title,
      description: m.description,
      project: m.project,
      topics: m.topics
    };
  });
}

export const SYLLABUS_TRACKS = [
  {
    id: 'tech-web',
    domainType: 'Technical',
    title: 'Web Development & Full Stack Development',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn how websites are structured, styled, made interactive, tested, and published online. Build a simple website using HTML, CSS, and JavaScript, then learn the basics of full-stack development.',
    toolsCovered: ['Visual Studio Code', 'Google Chrome', 'HTML', 'CSS', 'JavaScript', 'GitHub', 'GitHub Pages'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Web Development & HTML',
        description: 'Understand how websites work and learn the basic structure of an HTML page. Practise headings, paragraphs, links, images, and buttons.',
        project: 'Create a simple personal profile webpage.',
        topics: ['Headings & paragraphs', 'Links, images & buttons', 'Basic HTML page structure', 'Project: Personal profile webpage']
      },
      {
        title: 'HTML Elements & Forms',
        description: 'Learn lists, tables, input fields, labels, dropdowns, and form elements. Organize content using header, navigation, main, and footer sections.',
        project: 'Create a student registration form.',
        topics: ['Lists, tables & form controls', 'Labels & dropdowns', 'Semantic header, nav, main & footer', 'Project: Student registration form']
      },
      {
        title: 'CSS Fundamentals',
        description: "Learn how CSS changes a webpage's appearance using colours, fonts, backgrounds, borders, margins, and padding.",
        project: 'Style the student registration page.',
        topics: ['Colours, fonts & backgrounds', 'Borders, margins & padding', 'Visual page styling', 'Project: Style registration page']
      },
      {
        title: 'Website Layout & Responsive Design',
        description: 'Practise arranging content with Flexbox, cards, navigation bars, and sections. Make a page fit mobile, tablet, and desktop screens.',
        project: 'Make the webpage responsive.',
        topics: ['Flexbox layouts & cards', 'Navigation bars & sections', 'Mobile, tablet & desktop viewports', 'Project: Responsive webpage']
      },
      {
        title: 'JavaScript Basics',
        description: 'Learn variables, data types, operators, conditions, and functions. Use JavaScript to respond to button clicks and user input.',
        project: 'Create a simple calculator or marks calculator.',
        topics: ['Variables, data types & operators', 'Conditions & functions', 'Button click & input events', 'Project: Calculator / marks calculator']
      },
      {
        title: 'JavaScript DOM & Form Validation',
        description: 'Learn to select and update webpage elements. Check required fields and show simple success or error messages.',
        project: 'Add validation to the registration form.',
        topics: ['Selecting & updating DOM elements', 'Required-field checks', 'Success & error feedback messages', 'Project: Validated registration form']
      },
      {
        title: 'Introduction to Backend & APIs',
        description: 'Understand what a server and database do. Learn the basic idea of sending form data to a backend and receiving information from an API.',
        project: 'Create a simple page that displays sample data from an API.',
        topics: ['Server & database basics', 'Sending form data to backend', 'Receiving data from APIs', 'Project: Sample API data page']
      },
      {
        title: 'Building a Complete Website',
        description: 'Combine Home, About, Services or Projects, and Contact sections. Add navigation and keep the design consistent.',
        project: 'Build a personal portfolio or business landing page.',
        topics: ['Multi-section website layout', 'Consistent styling & navigation', 'Home, About, Projects & Contact', 'Project: Portfolio / landing page']
      },
      {
        title: 'GitHub & Website Testing',
        description: 'Test the website on different screen sizes, fix common errors, and learn how to upload project files to a GitHub repository.',
        project: 'Test the website and upload the project to GitHub.',
        topics: ['Cross-screen testing', 'Debugging layout & code issues', 'Uploading files to GitHub', 'Project: GitHub repository upload']
      },
      {
        title: 'Website Publishing & Final Project',
        description: 'Publish a static website using GitHub Pages. Check links, images, and layout, then explain the completed project.',
        project: 'Publish and present a responsive portfolio or business website.',
        topics: ['Static hosting via GitHub Pages', 'Checking links, images & layout', 'Final project walkthrough', 'Project: Published live website']
      }
    ])
  },
  {
    id: 'tech-app',
    domainType: 'Technical',
    title: 'App Development',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn mobile app design, user interactions, app logic, data storage, testing, and basic Android-style app building using MIT App Inventor.',
    toolsCovered: ['MIT App Inventor', 'Browser', 'Android phone or emulator', 'TinyDB'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Mobile App Development',
        description: "Understand what mobile apps are and the difference between mobile apps and websites. Explore MIT App Inventor's Designer and Blocks workspaces.",
        project: 'Create a simple welcome screen.',
        topics: ['Mobile apps vs websites', 'Android & iOS basics', 'MIT App Inventor Designer & Blocks', 'Project: Simple welcome screen']
      },
      {
        title: 'App Screen Design & Components',
        description: 'Add and arrange labels, buttons, text boxes, images, lists, and layouts. Change colours, fonts, alignment, and screen settings.',
        project: 'Design a profile or contact information screen.',
        topics: ['Labels, buttons & text boxes', 'Images, lists & screen layouts', 'Colours, fonts & alignment', 'Project: Profile / contact screen']
      },
      {
        title: 'Events & User Interaction',
        description: 'Connect buttons to actions, read text entered by users, update screen content, and display messages.',
        project: "Create a greeting app that uses the user's name.",
        topics: ['Event-based programming', 'Reading user text input', 'Updating screen output dynamically', 'Project: Personalized greeting app']
      },
      {
        title: 'Variables, Conditions & Calculations',
        description: 'Use variables, simple conditions, and maths blocks. Take input from users and display a calculated result.',
        project: 'Build a calculator or marks/grade calculator.',
        topics: ['Variables & condition blocks', 'Mathematical operations', 'Input-to-result calculations', 'Project: Calculator / marks app']
      },
      {
        title: 'Multiple Screens & Navigation',
        description: 'Create more than one screen and move between screens. Practise simple Home and Back navigation.',
        project: 'Create a multi-screen quiz app.',
        topics: ['Organizing multiple screens', 'Screen switching logic', 'Home & Back navigation', 'Project: Multi-screen quiz app']
      },
      {
        title: 'Lists & Repeated Data',
        description: 'Create and display lists of tasks, questions, or expenses. Learn to add and remove list items using blocks.',
        project: 'Build a basic to-do list app.',
        topics: ['Creating & displaying lists', 'Adding & removing list items', 'Visual list blocks', 'Project: Basic to-do list app']
      },
      {
        title: 'Local Data Storage',
        description: 'Understand why apps save information. Use TinyDB to save and retrieve simple values after an app is closed.',
        project: 'Create a notes app with saved entries.',
        topics: ['Why apps persist data', 'TinyDB save & retrieve blocks', 'Preserving entries across restarts', 'Project: Persistent notes app']
      },
      {
        title: 'Phone Features & User Experience',
        description: 'Try a supported phone feature such as sound, camera, or sharing. Add input checks, confirmation messages, and simple error handling.',
        project: 'Add one suitable phone feature to the app.',
        topics: ['Sound, camera & sharing features', 'Input validation & confirmations', 'Basic error handling & UX', 'Project: Phone-feature app upgrade']
      },
      {
        title: 'Final App Project Development',
        description: "Plan the app's screens and user flow. Combine interface components, app logic, and saved data, then test the main features.",
        project: 'Build an attendance tracker, quiz app, task manager, or expense tracker.',
        topics: ['Screen & user flow planning', 'Combining UI, logic & TinyDB', 'Feature integration testing', 'Project: Tracker / quiz / manager app']
      },
      {
        title: 'App Testing & Project Presentation',
        description: 'Test screens and buttons, fix common issues, improve the interface, and prepare a short project demonstration. Build an APK if supported.',
        project: 'Present a working beginner-level mobile app.',
        topics: ['Screen & button QA testing', 'Fixing UI & logic issues', 'Optional Android APK build', 'Project: Working mobile app demo']
      }
    ])
  },
  {
    id: 'tech-python',
    domainType: 'Technical',
    title: 'Python Programming',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn the basics of Python through short coding exercises. Practise using input, conditions, loops, functions, files, and simple automation.',
    toolsCovered: ['Python 3', 'IDLE or Visual Studio Code', 'Terminal', 'Basic Python modules'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Python',
        description: 'Understand what Python is used for. Set up a beginner coding environment and run your first program.',
        project: 'Write a program that displays a personal introduction.',
        topics: ['What Python is used for', 'Python 3 setup & IDE basics', 'Running your first script', 'Project: Personal introduction program']
      },
      {
        title: 'Variables & Data Types',
        description: 'Learn variables, numbers, text, Boolean values, and how to receive input from a user.',
        project: 'Create a simple personal details program.',
        topics: ['Variables, ints, floats & strings', 'Boolean values', 'Reading console input', 'Project: Personal details program']
      },
      {
        title: 'Operators & Conditions',
        description: 'Practise arithmetic and comparison operators. Use if, elif, and else to make decisions in a program.',
        project: 'Create an age checker or simple grade calculator.',
        topics: ['Arithmetic & comparison operators', 'if, elif & else statements', 'Decision branching logic', 'Project: Age checker / grade calculator']
      },
      {
        title: 'Loops',
        description: 'Learn for and while loops to repeat tasks. Use simple examples to understand counters and repeated actions.',
        project: 'Create a multiplication table generator.',
        topics: ['for & while loops', 'Counters & iteration', 'Repeating automated actions', 'Project: Multiplication table generator']
      },
      {
        title: 'Strings & Lists',
        description: 'Work with text and lists. Practise accessing, adding, removing, and updating items.',
        project: 'Create a shopping list program.',
        topics: ['String methods & slicing', 'List indexing & updates', 'Adding & removing items', 'Project: Shopping list program']
      },
      {
        title: 'Dictionaries & Functions',
        description: 'Store information using dictionaries and organize reusable code using functions.',
        project: 'Create a student record program.',
        topics: ['Key-value dictionaries', 'Defining & calling functions', 'Reusable modular code', 'Project: Student record program']
      },
      {
        title: 'Working with Files',
        description: 'Learn to open, read, and write simple text files. Understand how programs can save information.',
        project: 'Create a notes app that saves text to a file.',
        topics: ['Opening & closing files', 'Reading & writing text files', 'Persistent local data', 'Project: File-based notes app']
      },
      {
        title: 'Error Handling & Modules',
        description: 'Learn basic try/except error handling and how to use built-in Python modules.',
        project: 'Create a safe calculator that handles invalid input.',
        topics: ['try / except error handling', 'Validating bad user input', 'Built-in Python modules', 'Project: Safe input calculator']
      },
      {
        title: 'Mini Project Development',
        description: 'Plan a small project, break it into simple steps, and combine the Python topics learned so far.',
        project: 'Build an expense tracker or quiz program.',
        topics: ['Breaking problems into steps', 'Combining loops, dicts & files', 'End-to-end mini project build', 'Project: Expense tracker / quiz']
      },
      {
        title: 'Testing & Project Presentation',
        description: 'Test the program with different inputs, correct common errors, and explain how the project works.',
        project: 'Present the completed Python mini project.',
        topics: ['Edge-case input testing', 'Debugging & code cleanup', 'Walkthrough presentation', 'Project: Completed Python mini project']
      }
    ])
  },
  {
    id: 'tech-aiml',
    domainType: 'Technical',
    title: 'Artificial Intelligence & Machine Learning',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Understand everyday uses of AI and learn beginner-level machine learning concepts. Explore simple datasets, model training, and responsible use of AI tools.',
    toolsCovered: ['Beginner-friendly AI tools', 'Google Colab or Jupyter Notebook', 'Sample datasets', 'Spreadsheet software'],
    modules: buildTrackModules([
      {
        title: 'Introduction to AI',
        description: 'Understand artificial intelligence through familiar examples such as voice assistants, recommendations, and chatbots.',
        project: 'List and explain five everyday uses of AI.',
        topics: ['Voice assistants & chatbots', 'Recommendation systems', 'Everyday AI applications', 'Project: Five everyday uses of AI']
      },
      {
        title: 'AI Tools & Prompt Writing',
        description: 'Explore beginner-friendly AI tools. Practise writing clear prompts and checking whether the answers are useful.',
        project: 'Create a useful prompt set for study or office tasks.',
        topics: ['Exploring beginner AI tools', 'Clear & specific prompt writing', 'Verifying AI output quality', 'Project: Study / office prompt set']
      },
      {
        title: 'Introduction to Machine Learning',
        description: 'Understand how machine learning uses examples and data to identify patterns. Learn the difference between AI and ML.',
        project: 'Sort real-life examples into AI and non-AI uses.',
        topics: ['Learning patterns from data', 'AI vs Machine Learning', 'Real-world ML examples', 'Project: AI vs non-AI classification']
      },
      {
        title: 'Data & Features',
        description: 'Learn what a dataset, row, column, and feature mean. Identify useful information in a small sample dataset.',
        project: 'Prepare a simple student marks or house-price dataset.',
        topics: ['Datasets, rows & columns', 'Selecting predictive features', 'Structuring tabular data', 'Project: Marks / house-price dataset']
      },
      {
        title: 'Types of Machine Learning',
        description: 'Understand supervised and unsupervised learning through easy examples such as prediction and grouping.',
        project: 'Match simple problems to the correct learning type.',
        topics: ['Supervised prediction tasks', 'Unsupervised grouping tasks', 'Matching problems to algorithms', 'Project: Learning-type mapping']
      },
      {
        title: 'Preparing Data',
        description: 'Learn why data must be checked and cleaned. Practise finding missing values, repeated rows, and incorrect entries.',
        project: 'Clean a small sample dataset.',
        topics: ['Detecting missing values', 'Removing duplicate rows', 'Fixing incorrect entries', 'Project: Cleaned sample dataset']
      },
      {
        title: 'First ML Model',
        description: 'Use a beginner-friendly notebook or visual tool to train a simple prediction model with prepared data.',
        project: 'Train a basic model using a sample dataset.',
        topics: ['Google Colab / visual ML tools', 'Training on prepared data', 'Running first model fit', 'Project: Basic prediction model']
      },
      {
        title: 'Checking Model Results',
        description: 'Understand predictions, accuracy, and why a model can make mistakes. Test the model with new examples.',
        project: 'Record and discuss sample model predictions.',
        topics: ['Evaluating prediction accuracy', 'Understanding model errors', 'Testing with unseen inputs', 'Project: Model predictions log']
      },
      {
        title: 'AI Mini Project',
        description: 'Choose a simple problem and combine a dataset, an AI/ML tool, and a clear result.',
        project: 'Create a simple prediction or classification demonstration.',
        topics: ['Problem scoping & dataset pairing', 'Running ML / AI workflow', 'Generating clear predictions', 'Project: Prediction / classification demo']
      },
      {
        title: 'Review & Responsible AI',
        description: 'Present the mini project. Discuss privacy, fairness, checking AI outputs, and the limits of AI systems.',
        project: 'Demonstrate the project and explain its result and limitations.',
        topics: ['Privacy & fairness considerations', 'Verifying outputs & model limits', 'Final project defense', 'Project: Responsible AI demonstration']
      }
    ])
  },
  {
    id: 'tech-datascience',
    domainType: 'Technical',
    title: 'Data Science & Analytics',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn how to collect, organize, clean, understand, and present data. Use simple spreadsheet exercises and beginner Python tools to create charts and reports.',
    toolsCovered: ['Microsoft Excel or Google Sheets', 'Python', 'Google Colab or Jupyter Notebook', 'Pandas', 'Power BI'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Data & Data Science',
        description: 'Understand what data is and how businesses use it to make decisions. Learn the difference between rows, columns, and records.',
        project: 'Identify useful information in a sample sales dataset.',
        topics: ['Data-driven decision making', 'Rows, columns & records', 'Exploring business datasets', 'Project: Sales dataset exploration']
      },
      {
        title: 'Spreadsheets for Data',
        description: 'Enter data, format cells, sort records, and use simple formulas in a spreadsheet.',
        project: 'Create a student marks or daily expense sheet.',
        topics: ['Cell formatting & sorting', 'Basic spreadsheet formulas', 'Structured tables in Excel / Sheets', 'Project: Marks / daily expense sheet']
      },
      {
        title: 'Data Cleaning',
        description: 'Find blank cells, duplicate records, spelling differences, and incorrect values. Practise correcting a small dataset.',
        project: 'Clean a sample customer or sales dataset.',
        topics: ['Finding blanks & duplicates', 'Fixing spelling inconsistencies', 'Correcting malformed entries', 'Project: Cleaned customer/sales data']
      },
      {
        title: 'Basic Data Analysis',
        description: 'Calculate totals, averages, minimums, and maximums. Learn how simple summaries help explain data.',
        project: 'Prepare a summary of monthly sales or student marks.',
        topics: ['Totals, averages, MIN & MAX', 'Summarizing key metrics', 'Interpreting numerical trends', 'Project: Monthly sales/marks summary']
      },
      {
        title: 'Introduction to Python for Data',
        description: 'Understand how Python can help work with data. Open a notebook and run simple commands.',
        project: 'Load and view a small sample dataset.',
        topics: ['Colab / Jupyter notebooks', 'Running basic Python commands', 'Inspecting sample files', 'Project: Load sample dataset in Python']
      },
      {
        title: 'NumPy & Pandas Basics',
        description: 'Explore simple arrays and tables. Practise viewing columns, selecting rows, and calculating basic values.',
        project: 'Create a small data summary using Pandas.',
        topics: ['NumPy arrays & Pandas tables', 'Selecting rows & columns', 'Summary calculations in Pandas', 'Project: Pandas data summary']
      },
      {
        title: 'Charts & Data Visualization',
        description: 'Choose suitable bar, line, and pie charts. Learn how titles and labels make charts easier to understand.',
        project: 'Create three charts from a sample dataset.',
        topics: ['Bar, line & pie charts', 'Clear chart titles & axis labels', 'Visual storytelling', 'Project: Three dataset charts']
      },
      {
        title: 'Introduction to Power BI',
        description: 'Explore the Power BI interface. Import a spreadsheet and create simple visuals.',
        project: 'Build a basic sales dashboard.',
        topics: ['Power BI workspace', 'Importing spreadsheet data', 'Creating KPI cards & charts', 'Project: Basic sales dashboard']
      },
      {
        title: 'Dashboard Development',
        description: 'Arrange charts, summary cards, and filters. Practise presenting information clearly.',
        project: 'Create an interactive dashboard for a sample business.',
        topics: ['Interactive filters & slicers', 'Dashboard layout & hierarchy', 'Business KPI alignment', 'Project: Interactive business dashboard']
      },
      {
        title: 'Final Report & Presentation',
        description: 'Check the data, explain the main findings, and present the dashboard in simple language.',
        project: 'Present a data analysis report and dashboard.',
        topics: ['Validating report numbers', 'Explaining key findings simply', 'Executive dashboard walkthrough', 'Project: Data report & dashboard demo']
      }
    ])
  },
  {
    id: 'tech-uiux',
    domainType: 'Technical',
    title: 'UI/UX Design',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn how to plan and design easy-to-use website and mobile app screens. Practise layouts, colours, typography, wireframes, and clickable prototypes.',
    toolsCovered: ['Figma', 'Browser', 'Paper and pencil for early wireframes'],
    modules: buildTrackModules([
      {
        title: 'Introduction to UI & UX',
        description: 'Understand the difference between user interface and user experience. Review examples of easy-to-use apps and websites.',
        project: 'Identify good and confusing design elements in an app.',
        topics: ['UI vs UX fundamentals', 'Characteristics of usable apps', 'Evaluating existing interfaces', 'Project: App UI/UX critique']
      },
      {
        title: 'Design Principles',
        description: 'Learn about alignment, spacing, contrast, colours, and visual hierarchy.',
        project: 'Create a simple design mood board.',
        topics: ['Alignment & whitespace', 'Contrast & colour balance', 'Visual hierarchy rules', 'Project: Simple design mood board']
      },
      {
        title: 'Understanding Users',
        description: 'Learn how to identify users, their needs, and the problems a design should solve.',
        project: 'Write a simple user profile and list user needs.',
        topics: ['Identifying target users', 'Defining pain points & goals', 'User-centered problem framing', 'Project: User profile & needs list']
      },
      {
        title: 'User Flow & Wireframes',
        description: 'Plan the steps a user follows in an app. Draw basic screen layouts using boxes and labels.',
        project: 'Create a wireframe for a login and home screen.',
        topics: ['Mapping step-by-step user flows', 'Low-fidelity boxes & labels', 'Screen layout planning', 'Project: Login & home wireframes']
      },
      {
        title: 'Introduction to Figma',
        description: 'Explore the Figma workspace. Create frames, add shapes, and arrange basic design elements.',
        project: 'Design a simple mobile app screen.',
        topics: ['Figma canvas & frames', 'Shapes, layers & arrangement', 'Screen dimensions & grids', 'Project: Mobile app screen in Figma']
      },
      {
        title: 'Typography, Colours & Components',
        description: 'Choose readable fonts and matching colours. Create reusable buttons, fields, and other components.',
        project: 'Create a small style guide and component set.',
        topics: ['Readable typography scales', 'Matching colour palettes', 'Reusable buttons & form components', 'Project: Style guide & component set']
      },
      {
        title: 'Designing Multiple Screens',
        description: 'Use the same style across screens. Practise designing navigation, forms, cards, and content sections.',
        project: 'Design three connected app screens.',
        topics: ['Cross-screen consistency', 'Navigation, forms & cards', 'Structured content sections', 'Project: Three connected app screens']
      },
      {
        title: 'Prototyping & Interaction',
        description: 'Connect screens and add clickable buttons to show how the app works.',
        project: 'Create a clickable prototype.',
        topics: ['Linking Figma screen flows', 'Interactive button triggers', 'Simulating user journeys', 'Project: Clickable Figma prototype']
      },
      {
        title: 'Feedback & Design Improvements',
        description: 'Ask someone to try the prototype. Note confusing areas and improve the layout and navigation.',
        project: 'Improve the prototype using feedback.',
        topics: ['Usability walkthroughs', 'Spotting navigation friction', 'Iterating layout clarity', 'Project: Feedback-refined prototype']
      },
      {
        title: 'Final Design Presentation',
        description: 'Organize the final screens, explain the design choices, and demonstrate the prototype.',
        project: 'Present a website or mobile app design prototype.',
        topics: ['Organizing final design boards', 'Explaining colour & layout choices', 'Live prototype walkthrough', 'Project: Final UI/UX prototype pitch']
      }
    ])
  },
  {
    id: 'tech-iot',
    domainType: 'Technical',
    title: 'IoT & Embedded Systems',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Understand how sensors and small electronic boards work together to collect information and control devices. Build simple beginner projects using a microcontroller.',
    toolsCovered: ['Arduino IDE', 'Arduino or ESP32 board', 'Breadboard', 'LEDs & resistors', 'Basic sensors', 'USB cable'],
    modules: buildTrackModules([
      {
        title: 'Introduction to IoT',
        description: 'Understand the Internet of Things through examples such as smart lights and temperature monitoring. Learn the basic parts of an IoT system.',
        project: 'Draw a simple smart-home IoT system.',
        topics: ['Smart-home & monitoring examples', 'Sensors, controllers & connectivity', 'End-to-end IoT architecture', 'Project: Smart-home IoT diagram']
      },
      {
        title: 'Basic Electronics & Components',
        description: 'Identify common components such as LEDs, resistors, switches, sensors, and breadboards. Learn basic electrical safety.',
        project: 'Identify components and make a simple LED circuit.',
        topics: ['LEDs, resistors, switches & sensors', 'Breadboard wiring basics', 'Electrical safety habits', 'Project: Simple LED circuit']
      },
      {
        title: 'Introduction to Microcontrollers',
        description: 'Understand what a microcontroller does. Explore an Arduino or ESP32 board and identify its main pins.',
        project: 'Set up the board and run a basic LED blink example.',
        topics: ['Role of microcontrollers', 'Arduino / ESP32 pin layout', 'Arduino IDE board setup', 'Project: Basic LED blink demo']
      },
      {
        title: 'Basic Programming for Boards',
        description: 'Learn simple code structure, variables, and digital input/output using beginner examples.',
        project: 'Control an LED using a simple program.',
        topics: ['setup() & loop() structure', 'Variables & digital I/O', 'Uploading board sketches', 'Project: Programmed LED control']
      },
      {
        title: 'Working with Sensors',
        description: 'Understand how sensors measure things such as light, distance, and temperature. Read simple sensor values.',
        project: 'Read and display a sensor value.',
        topics: ['Light, distance & temp sensors', 'Analog & digital signal reading', 'Displaying live sensor values', 'Project: Sensor readout demo']
      },
      {
        title: 'Working with Outputs',
        description: 'Learn how boards control LEDs, buzzers, and other simple output devices.',
        project: 'Build a sensor-based LED or buzzer alert.',
        topics: ['Driving LEDs & buzzers', 'Threshold condition triggers', 'Hardware output feedback', 'Project: Sensor-based alert']
      },
      {
        title: 'Connecting to Wi-Fi',
        description: 'Understand how an ESP32 connects to a Wi-Fi network. Learn the basic idea of sending sensor data online.',
        project: 'Demonstrate a basic Wi-Fi connection.',
        topics: ['ESP32 Wi-Fi setup', 'Network credentials & status', 'Intro to online telemetry', 'Project: ESP32 Wi-Fi connection']
      },
      {
        title: 'IoT Data Monitoring',
        description: 'View sensor readings on a simple serial monitor or beginner dashboard. Understand how data can be checked over time.',
        project: 'Create a simple temperature or light monitoring demo.',
        topics: ['Serial monitor telemetry', 'Beginner monitoring dashboards', 'Tracking readings over time', 'Project: Temp / light monitor']
      },
      {
        title: 'Mini Project Development',
        description: 'Combine a board, sensor, and output device to solve a small practical problem.',
        project: 'Build a basic smart-light or environment-monitoring prototype.',
        topics: ['Integrating board, sensor & output', 'Solving practical automation problems', 'Prototype wiring & firmware', 'Project: Smart-light / monitor build']
      },
      {
        title: 'Testing & Project Presentation',
        description: 'Check wiring and readings, correct simple issues, and explain how the device works.',
        project: 'Demonstrate the completed IoT prototype.',
        topics: ['Circuit & reading verification', 'Troubleshooting wiring & code', 'Hardware demo walkthrough', 'Project: Completed IoT prototype']
      }
    ])
  },
  {
    id: 'nontech-hr',
    domainType: 'Non-Technical',
    title: 'Human Resource Management',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Understand the basic work of an HR team, from finding candidates and arranging interviews to onboarding employees and maintaining records.',
    toolsCovered: ['Microsoft Excel or Google Sheets', 'Word or Google Docs', 'Email', 'Sample HR forms'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Human Resources',
        description: 'Understand the role of HR in an organization and learn common HR responsibilities.',
        project: 'Prepare a simple chart showing the main duties of an HR team.',
        topics: ['Role of HR in organizations', 'Core HR responsibilities', 'Supporting employees & managers', 'Project: HR duties overview chart']
      },
      {
        title: 'Workplace Communication',
        description: 'Practise polite email writing, phone communication, and professional conversations.',
        project: 'Write a simple interview invitation email.',
        topics: ['Polite workplace emails', 'Professional phone etiquette', 'Clear candidate communication', 'Project: Interview invitation email']
      },
      {
        title: 'Job Descriptions & Hiring',
        description: 'Learn what a job description contains and how companies announce vacancies.',
        project: 'Prepare a job description for an entry-level role.',
        topics: ['Key parts of a job description', 'Role skills & responsibilities', 'Announcing open vacancies', 'Project: Entry-level job description']
      },
      {
        title: 'Resume Screening',
        description: 'Learn how to read resumes and compare candidate details with job requirements.',
        project: 'Review sample resumes and prepare a shortlist.',
        topics: ['Reading candidate resumes', 'Matching profiles to requirements', 'Shortlisting criteria', 'Project: Candidate shortlist']
      },
      {
        title: 'Interview Coordination',
        description: 'Understand how to schedule interviews, contact candidates, and maintain interview records.',
        project: 'Prepare a sample interview schedule.',
        topics: ['Scheduling interview slots', 'Confirming with candidates & panels', 'Logging interview status', 'Project: Sample interview schedule']
      },
      {
        title: 'Employee Onboarding',
        description: 'Learn the steps involved when a new employee joins, including forms, orientation, and basic introductions.',
        project: 'Create a new-employee onboarding checklist.',
        topics: ['Joining forms & verification', 'Company orientation steps', 'Team introductions', 'Project: Onboarding checklist']
      },
      {
        title: 'Attendance & Leave Records',
        description: 'Understand how attendance and leave details are recorded and organized.',
        project: 'Prepare a simple attendance tracker in a spreadsheet.',
        topics: ['Tracking daily attendance', 'Logging employee leave entries', 'Spreadsheet organization', 'Project: Attendance tracker sheet']
      },
      {
        title: 'Employee Engagement',
        description: 'Learn simple ways to welcome employees, collect feedback, and support teamwork.',
        project: 'Prepare a short employee feedback form.',
        topics: ['Welcoming new hires', 'Teamwork & engagement ideas', 'Collecting workplace feedback', 'Project: Employee feedback form']
      },
      {
        title: 'HR Documentation',
        description: 'Understand basic HR records such as employee details, joining forms, and training records. Handle information carefully.',
        project: 'Create a sample employee information tracker.',
        topics: ['Employee & training records', 'Joining document checklists', 'Confidential record handling', 'Project: Employee info tracker']
      },
      {
        title: 'HR Mini Project & Review',
        description: 'Combine recruitment, interview coordination, and onboarding activities into a simple HR workflow.',
        project: 'Present a sample recruitment-to-onboarding process.',
        topics: ['End-to-end hiring workflow', 'Connecting screening to onboarding', 'Reviewing HR deliverables', 'Project: Recruitment-to-onboarding flow']
      }
    ])
  },
  {
    id: 'nontech-marketing',
    domainType: 'Non-Technical',
    title: 'Marketing',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn how businesses understand customers, study competitors, plan marketing activities, and communicate the value of a product or service.',
    toolsCovered: ['Google Forms', 'Spreadsheets', 'Presentation software', 'Internet research'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Marketing',
        description: 'Understand what marketing means and how products or services reach customers.',
        project: 'Choose a familiar product and explain how it is marketed.',
        topics: ['Meaning & scope of marketing', 'How products reach customers', 'Real-world marketing examples', 'Project: Product marketing breakdown']
      },
      {
        title: 'Products & Customers',
        description: 'Learn about customer needs, product features, and the value a product offers.',
        project: 'Prepare a simple product and customer profile.',
        topics: ['Customer needs & expectations', 'Product features vs value', 'Matching offers to buyers', 'Project: Product & customer profile']
      },
      {
        title: 'Market Research',
        description: 'Understand how to collect basic information through observation, simple surveys, and online research.',
        project: 'Create a short customer survey.',
        topics: ['Observation & online research', 'Designing clear survey questions', 'Collecting customer insights', 'Project: Short customer survey']
      },
      {
        title: 'Customer Segmentation',
        description: 'Learn how customers can be grouped by needs, interests, age range, or location.',
        project: 'Group sample customers into simple segments.',
        topics: ['Demographic & location traits', 'Grouping by needs & interests', 'Choosing target segments', 'Project: Customer segment table']
      },
      {
        title: 'Competitor Research',
        description: 'Identify competing products and compare their features, prices, and messages.',
        project: 'Prepare a simple competitor comparison table.',
        topics: ['Identifying competing brands', 'Comparing features & pricing', 'Studying competitor messaging', 'Project: Competitor comparison table']
      },
      {
        title: 'Marketing Mix',
        description: 'Learn the basic 4Ps: Product, Price, Place, and Promotion.',
        project: 'Create a 4P plan for a sample product.',
        topics: ['Product & Price decisions', 'Place (distribution) channels', 'Promotion mix basics', 'Project: Sample 4P marketing plan']
      },
      {
        title: 'Branding & Positioning',
        description: 'Understand brand names, logos, messages, and how a business wants customers to remember it.',
        project: 'Create a simple brand message for a product.',
        topics: ['Brand identity & recall', 'Names, logos & tone', 'Clear brand positioning', 'Project: Product brand message']
      },
      {
        title: 'Marketing Communication',
        description: 'Practise writing clear product descriptions and promotional messages.',
        project: 'Write a short product promotion.',
        topics: ['Clear product descriptions', 'Value-driven promotional copy', 'Customer-friendly language', 'Project: Short product promotion']
      },
      {
        title: 'Marketing Plan',
        description: 'Combine customer research, competitor information, and promotional ideas into a simple plan.',
        project: 'Prepare a one-week marketing activity plan.',
        topics: ['Integrating research insights', 'Scheduling promotional activities', 'Practical weekly execution', 'Project: One-week marketing plan']
      },
      {
        title: 'Marketing Project Presentation',
        description: 'Present the product, target customers, marketing message, and proposed activities.',
        project: 'Present a simple marketing plan for a product or service.',
        topics: ['Audience & message summary', 'Activity plan walkthrough', 'Presentation delivery', 'Project: Marketing plan pitch']
      }
    ])
  },
  {
    id: 'nontech-finance',
    domainType: 'Non-Technical',
    title: 'Finance & Accounting',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn basic accounting and financial concepts using easy examples. Practise recording transactions, preparing simple summaries, and managing a basic budget.',
    toolsCovered: ['Microsoft Excel or Google Sheets', 'Calculator', 'Sample invoices and receipts'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Finance & Accounting',
        description: 'Understand why businesses record money received and spent. Learn the difference between finance and accounting.',
        project: 'Identify income and expenses in a simple business example.',
        topics: ['Money in vs money out', 'Finance vs accounting basics', 'Why accurate records matter', 'Project: Income & expense review']
      },
      {
        title: 'Basic Accounting Terms',
        description: 'Learn assets, liabilities, income, expenses, debit, and credit using simple examples.',
        project: 'Classify sample items under the correct accounting terms.',
        topics: ['Assets & liabilities', 'Income & expenses', 'Debit & credit intuition', 'Project: Accounting term classification']
      },
      {
        title: 'Recording Transactions',
        description: 'Understand how daily business transactions are recorded and why receipts are important.',
        project: 'Prepare a simple daily transaction record.',
        topics: ['Daily transaction entries', 'Importance of bills & receipts', 'Chronological record keeping', 'Project: Daily transaction record']
      },
      {
        title: 'Cash Book & Expense Tracking',
        description: 'Learn how to record cash received and payments made. Calculate the remaining balance.',
        project: 'Create a basic cash book in a spreadsheet.',
        topics: ['Cash inflows & payments', 'Running cash balance calculations', 'Spreadsheet cash logs', 'Project: Basic spreadsheet cash book']
      },
      {
        title: 'Invoices & Bills',
        description: 'Understand the purpose of invoices, bills, receipts, and payment records.',
        project: 'Prepare a sample sales invoice.',
        topics: ['Invoice vs receipt purpose', 'Line items, totals & dates', 'Maintaining payment records', 'Project: Sample sales invoice']
      },
      {
        title: 'Introduction to Financial Statements',
        description: 'Learn what a profit and loss statement and balance sheet show at a basic level.',
        project: 'Prepare a simple income and expense summary.',
        topics: ['Profit & Loss statement overview', 'Balance sheet essentials', 'Summarizing net results', 'Project: Income & expense summary']
      },
      {
        title: 'Budgeting',
        description: 'Understand how to plan expected income and expenses and compare them with actual spending.',
        project: 'Create a monthly budget for a small business.',
        topics: ['Forecasting expected cash flows', 'Comparing planned vs actual spend', 'Budget discipline basics', 'Project: Small business monthly budget']
      },
      {
        title: 'Spreadsheet Skills for Finance',
        description: 'Use simple spreadsheet formulas such as SUM, subtraction, and percentage calculations.',
        project: 'Prepare an expense summary using formulas.',
        topics: ['SUM & subtraction formulas', 'Percentage calculations', 'Clean financial tables', 'Project: Formula-driven expense sheet']
      },
      {
        title: 'Tax & Financial Awareness',
        description: 'Learn the basic purpose of taxes and GST in India. Understand that actual tax filing needs qualified guidance.',
        project: 'Identify GST details on a sample invoice.',
        topics: ['Purpose of taxes & GST in India', 'Reading GST lines on invoices', 'Compliance awareness', 'Project: GST invoice inspection']
      },
      {
        title: 'Finance Mini Project & Review',
        description: 'Combine transaction records, invoices, and a budget into a simple financial file.',
        project: 'Present a basic monthly finance report.',
        topics: ['Consolidating records & budgets', 'Checking formula accuracy', 'Presenting financial summaries', 'Project: Monthly finance report']
      }
    ])
  },
  {
    id: 'nontech-digital-marketing',
    domainType: 'Non-Technical',
    title: 'Digital Marketing',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn how businesses promote products and services online. Practise creating content, understanding social media, and exploring basic SEO and campaign results.',
    toolsCovered: ['Canva', 'Social media platforms', 'Google Trends', 'Google Search', 'Spreadsheets'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Digital Marketing',
        description: 'Understand online marketing and how businesses use websites, search engines, and social media.',
        project: 'Identify the digital channels used by a familiar brand.',
        topics: ['Websites, search & social media', 'Digital vs traditional outreach', 'Mapping online customer touchpoints', 'Project: Brand digital channel audit']
      },
      {
        title: 'Content Planning',
        description: 'Learn how to choose topics and prepare useful content for a target audience.',
        project: 'Create a simple one-week content calendar.',
        topics: ['Choosing audience-focused topics', 'Balancing educational & promo posts', 'Weekly scheduling grids', 'Project: One-week content calendar']
      },
      {
        title: 'Social Media Basics',
        description: 'Explore common social media platforms and understand how businesses use posts, stories, and short videos.',
        project: 'Prepare three post ideas for a sample business.',
        topics: ['Platform strengths & formats', 'Posts, stories & short videos', 'Consistent brand presence', 'Project: Three social post concepts']
      },
      {
        title: 'Creative Content Writing',
        description: 'Practise writing simple captions, headlines, and calls to action.',
        project: 'Write captions for three promotional posts.',
        topics: ['Engaging hooks & headlines', 'Clear promotional captions', 'Effective calls to action (CTA)', 'Project: Three promotional captions']
      },
      {
        title: 'Basic Graphic Design',
        description: 'Learn simple design rules for readable social media posts, including colour, font, and layout.',
        project: 'Create a basic promotional social media post.',
        topics: ['Readable font pairings', 'Colour contrast & visual spacing', 'Canva post composition', 'Project: Promotional social graphic']
      },
      {
        title: 'Introduction to SEO',
        description: 'Understand how search engines find webpages. Learn keywords, page titles, and simple content improvements.',
        project: 'Choose keywords and write a page title for a sample business.',
        topics: ['How search engines discover pages', 'Beginner keyword selection', 'Page titles & readable copy', 'Project: Business keywords & page title']
      },
      {
        title: 'Email & Online Promotion',
        description: 'Understand the purpose of promotional emails and how to write a clear message.',
        project: 'Draft a simple promotional email.',
        topics: ['Subject lines & clear structure', 'Promotional email value props', 'Polite online outreach', 'Project: Sample promotional email']
      },
      {
        title: 'Introduction to Paid Ads',
        description: 'Learn the basic purpose of online ads, audiences, budgets, and campaign goals. Explore ad examples without launching paid campaigns.',
        project: 'Prepare a sample advertisement plan.',
        topics: ['Campaign goals & target audiences', 'Budget planning concepts', 'Reviewing real ad examples', 'Project: Sample ad campaign plan']
      },
      {
        title: 'Campaign Tracking',
        description: 'Understand basic measures such as reach, clicks, likes, and enquiries. Read a sample campaign report.',
        project: 'Prepare a simple campaign performance summary.',
        topics: ['Reach, clicks, likes & enquiries', 'Reading basic performance metrics', 'Spotting winning content', 'Project: Campaign performance summary']
      },
      {
        title: 'Digital Marketing Mini Project',
        description: 'Combine content ideas, social media posts, keywords, and campaign goals into a small plan.',
        project: 'Present a one-week digital marketing campaign.',
        topics: ['Combining content, SEO & promo goals', 'Cohesive multi-channel schedule', 'Presenting campaign strategy', 'Project: One-week digital campaign']
      }
    ])
  },
  {
    id: 'nontech-bd',
    domainType: 'Non-Technical',
    title: 'Business Development',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Understand how businesses find new opportunities, connect with potential clients, maintain relationships, and plan activities that support business growth.',
    toolsCovered: ['Spreadsheets', 'Email', 'Presentation software', 'Public business directories'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Business Development',
        description: 'Understand how business development supports company growth through new customers and partnerships.',
        project: 'List possible growth opportunities for a sample business.',
        topics: ['Customers & growth partnerships', 'How BD drives revenue growth', 'Identifying market potential', 'Project: Growth opportunities list']
      },
      {
        title: 'Understanding Products & Services',
        description: 'Learn how to explain what a company offers and what problems it solves for customers.',
        project: 'Prepare a short company and service introduction.',
        topics: ['Mapping offers to client pain points', 'Clear value explanations', 'Concise company pitches', 'Project: Company & service intro']
      },
      {
        title: 'Market Research',
        description: 'Learn how to identify target industries, customer groups, and possible business opportunities.',
        project: 'Prepare a list of potential customer groups.',
        topics: ['Exploring target industries', 'Defining customer segments', 'Spotting commercial openings', 'Project: Target customer groups list']
      },
      {
        title: 'Finding Potential Clients',
        description: 'Understand basic lead generation through directories, websites, events, and referrals. Use public business information responsibly.',
        project: 'Create a sample list of potential clients.',
        topics: ['Directories, websites & referrals', 'Responsible lead research', 'Building structured prospect lists', 'Project: Potential client prospect list']
      },
      {
        title: 'Professional Communication',
        description: 'Practise introductions, business emails, and polite follow-up messages.',
        project: 'Write an introductory email to a potential client.',
        topics: ['Professional first impressions', 'Clear B2B email writing', 'Polite follow-up etiquette', 'Project: Client introductory email']
      },
      {
        title: 'Client Needs & Presentations',
        description: 'Learn to ask questions, understand client requirements, and explain a suitable service.',
        project: 'Prepare a short service presentation.',
        topics: ['Asking discovery questions', 'Understanding client requirements', 'Matching services to needs', 'Project: Short service presentation']
      },
      {
        title: 'Negotiation Basics',
        description: 'Understand how to discuss requirements, timelines, and expectations professionally.',
        project: 'Practise a simple client discussion using a role-play.',
        topics: ['Clarifying scope & timelines', 'Managing client expectations', 'Professional negotiation tone', 'Project: Client discussion role-play']
      },
      {
        title: 'Follow-up & Relationship Management',
        description: 'Learn how to record conversations, plan follow-ups, and maintain professional client relationships.',
        project: 'Create a basic client follow-up tracker.',
        topics: ['Logging client conversations', 'Scheduling timely follow-ups', 'Long-term relationship care', 'Project: Client follow-up tracker']
      },
      {
        title: 'Business Proposal Basics',
        description: 'Understand the sections of a simple proposal, including client need, suggested service, timeline, and cost estimate.',
        project: 'Prepare a sample one-page business proposal.',
        topics: ['Client need & proposed solution', 'Delivery timeline & cost estimate', 'Structuring crisp proposals', 'Project: One-page business proposal']
      },
      {
        title: 'Business Development Mini Project',
        description: 'Combine research, lead generation, communication, and proposal preparation.',
        project: 'Present a simple business development plan.',
        topics: ['Connecting research to outreach', 'End-to-end BD pipeline review', 'Final plan presentation', 'Project: Business development plan']
      }
    ])
  },
  {
    id: 'nontech-sales',
    domainType: 'Non-Technical',
    title: 'Sales',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    overview: 'Learn the basic sales process, how to understand customer needs, explain products clearly, respond to questions, and maintain simple sales records.',
    toolsCovered: ['Spreadsheets', 'Email', 'Presentation software', 'Sample product catalogue or brochure'],
    modules: buildTrackModules([
      {
        title: 'Introduction to Sales',
        description: 'Understand the role of sales in a business and learn the steps from first contact to completed sale.',
        project: 'Map the steps involved in selling a familiar product.',
        topics: ['Role of sales in business', 'First contact to completed sale', 'Customer-first mindset', 'Project: Sales process step map']
      },
      {
        title: 'Product & Service Knowledge',
        description: 'Learn how to understand product features, benefits, price, and common customer questions.',
        project: 'Prepare a simple product information sheet.',
        topics: ['Features vs customer benefits', 'Pricing & offer clarity', 'Anticipating buyer FAQs', 'Project: Product information sheet']
      },
      {
        title: 'Understanding Customer Needs',
        description: 'Practise listening and asking clear questions to understand what a customer needs.',
        project: "Create five questions to understand a customer's requirements.",
        topics: ['Active customer listening', 'Open requirement questions', 'Diagnosing buyer priorities', 'Project: Five discovery questions']
      },
      {
        title: 'Finding & Contacting Leads',
        description: 'Understand basic ways to find potential customers and make a polite first contact.',
        project: 'Prepare a sample lead list and introduction message.',
        topics: ['Sourcing potential buyers', 'Respectful first-contact outreach', 'Organizing lead details', 'Project: Lead list & intro message']
      },
      {
        title: 'Sales Communication',
        description: 'Practise explaining a product in simple language and speaking politely with customers.',
        project: 'Deliver a short product introduction.',
        topics: ['Clear jargon-free explanations', 'Confident & polite delivery', 'Structuring short pitches', 'Project: Short product introduction']
      },
      {
        title: 'Handling Customer Questions',
        description: 'Learn how to respond to common questions and concerns honestly and clearly.',
        project: 'Prepare answers to five common customer questions.',
        topics: ['Honest & transparent responses', 'Addressing product concerns', 'Building buyer trust', 'Project: Five FAQ response guides']
      },
      {
        title: 'Sales Demonstration',
        description: 'Understand how to show a product or explain a service step by step.',
        project: 'Prepare a short product demonstration.',
        topics: ['Step-by-step product walkthrough', 'Highlighting practical benefits', 'Keeping demos focused', 'Project: Short product demonstration']
      },
      {
        title: 'Negotiation & Closing Basics',
        description: 'Learn how to discuss price and terms respectfully and explain the next step in a sale.',
        project: 'Practise a simple sales conversation through role-play.',
        topics: ['Respectful price & terms discussion', 'Stating clear next steps', 'Natural closing transitions', 'Project: Sales conversation role-play']
      },
      {
        title: 'Sales Records & Follow-up',
        description: 'Record customer details, enquiries, and follow-up dates. Understand basic sales targets.',
        project: 'Create a simple sales tracker in a spreadsheet.',
        topics: ['Logging enquiries & follow-ups', 'Understanding sales targets', 'Spreadsheet pipeline tracking', 'Project: Spreadsheet sales tracker']
      },
      {
        title: 'Sales Mini Project & Review',
        description: 'Combine product knowledge, customer communication, demonstration, and follow-up into a practice sales activity.',
        project: 'Present a mock sales pitch and completed sales tracker.',
        topics: ['Full mock sales presentation', 'Reviewing completed tracker logs', 'Final feedback & coaching', 'Project: Mock pitch & sales tracker']
      }
    ])
  }
];

const DOMAIN_ALIASES = new Map([
  ['web development & full stack development', 'Web Development & Full Stack Development'],
  ['full-stack web development & modern architecture', 'Web Development & Full Stack Development'],
  ['full-stack web development & cloud architecture', 'Web Development & Full Stack Development'],
  ['full-stack web development track', 'Web Development & Full Stack Development'],
  ['web development & cloud deployment', 'Web Development & Full Stack Development'],
  ['web development', 'Web Development & Full Stack Development'],
  ['app development', 'App Development'],
  ['android & cross-platform app development', 'App Development'],
  ['android & mobile development', 'App Development'],
  ['mobile app development', 'App Development'],
  ['python programming', 'Python Programming'],
  ['artificial intelligence & machine learning', 'Artificial Intelligence & Machine Learning'],
  ['data science & analytics', 'Data Science & Analytics'],
  ['business analytics & tech communication', 'Data Science & Analytics'],
  ['business analytics & data', 'Data Science & Analytics'],
  ['ui/ux design', 'UI/UX Design'],
  ['iot & embedded systems', 'IoT & Embedded Systems'],
  ['human resource management', 'Human Resource Management'],
  ['marketing', 'Marketing'],
  ['finance & accounting', 'Finance & Accounting'],
  ['digital marketing', 'Digital Marketing'],
  ['digital marketing & growth', 'Digital Marketing'],
  ['digital growth & product marketing', 'Digital Marketing'],
  ['business development', 'Business Development'],
  ['digital operations, analytics & growth strategy', 'Business Development'],
  ['digital operations & agile management', 'Business Development'],
  ['sales', 'Sales']
]);

/**
 * Resolves a track or legacy course name into its exact canonical Winter 2026 domain title.
 */
export function resolveCanonicalDomain(rawDomain) {
  const clean = String(rawDomain || '').trim();
  if (!clean || clean.toLowerCase() === 'all') return null;
  const aliasHit = DOMAIN_ALIASES.get(clean.toLowerCase());
  if (aliasHit) return aliasHit;
  const exact = SYLLABUS_TRACKS.find(t => t.title.toLowerCase() === clean.toLowerCase() || t.id.toLowerCase() === clean.toLowerCase());
  return exact ? exact.title : null;
}

/**
 * Strict domain check: students can watch only recorded videos matching their chosen domain.
 */
export function matchesStudentDomain(videoTrack, studentDomain) {
  const vt = resolveCanonicalDomain(videoTrack);
  const st = resolveCanonicalDomain(studentDomain);
  return Boolean(vt && st && vt === st);
}

export const sharedSupportTickets = [];

export const sharedDevicePolicyState = {
  // Explicitly toggled value when DB test_settings.desktop_only column is absent
  desktopOnlyOverride: null,
  // Map of lowercase key (`uid:<id>`, `email:<email>`, `app:<appId>`) -> { allowed: boolean, reason: string, updatedAt: string }
  mobileOverrides: new Map(),
  // Shared in-memory mirror of recent blocked attempts (also persisted to admin_audit_logs)
  blockedEvents: []
};

const MOBILE_UA_RE = /\b(Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Kindle|Silk|PlayBook|Mobile|Tablet|Windows Phone|webOS)\b/i;
const MOBILE_CH_PLATFORM_RE = /^(Android|iOS|iPhone|iPad)$/i;

/**
 * Normalizes untrusted client device signal payload into typed flags.
 */
export function normalizeClientDeviceSignals(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.deviceSignals && typeof raw.deviceSignals === 'object' ? raw.deviceSignals : raw;
  const hasAny = ['ua', 'userAgent', 'userAgentDataMobile', 'maxTouchPoints', 'pointerCoarse', 'hoverNone', 'screenWidth']
    .some(k => src[k] !== undefined);
  if (!hasAny) return null;
  const sw = Number(src.screenWidth);
  const tp = Number(src.maxTouchPoints);
  return {
    ua: typeof (src.ua ?? src.userAgent) === 'string' ? String(src.ua ?? src.userAgent).slice(0, 400) : '',
    userAgentDataMobile: src.userAgentDataMobile === true,
    maxTouchPoints: Number.isFinite(tp) && tp >= 0 ? tp : 0,
    pointerCoarse: src.pointerCoarse === true,
    hoverNone: src.hoverNone === true,
    screenWidth: Number.isFinite(sw) && sw > 0 ? sw : 0
  };
}

/**
 * Evaluates whether a request originates from an allowed laptop/desktop computer.
 * Never rejects touch-capable laptops on touch count alone; rejects mobile/tablet UAs,
 * Sec-CH-UA-Mobile: ?1, coarse+no-hover devices, iPadOS desktop mode, and screens < 1024px.
 */
export function assessAssessmentDevice({
  headers = {},
  clientSignals = null,
  desktopOnly = true,
  mobileOverride = false
} = {}) {
  if (desktopOnly === false) {
    return { allowed: true, code: null, reason: 'desktop_only_disabled', signals: null };
  }
  if (mobileOverride === true) {
    return { allowed: true, code: null, reason: 'admin_mobile_override', signals: null };
  }

  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    normalizedHeaders[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }

  const headerUa = String(normalizedHeaders['user-agent'] || '').trim();
  const secChMobile = String(normalizedHeaders['sec-ch-ua-mobile'] || '').trim();
  const secChPlatform = String(normalizedHeaders['sec-ch-ua-platform'] || '').trim().replace(/^"|"$/g, '');
  const sig = normalizeClientDeviceSignals(clientSignals);
  const effectiveUa = headerUa || sig?.ua || '';

  if (secChMobile === '?1') {
    return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'sec_ch_ua_mobile', signals: sig };
  }
  if (MOBILE_UA_RE.test(effectiveUa)) {
    return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'user_agent_mobile_or_tablet', signals: sig };
  }
  if (MOBILE_CH_PLATFORM_RE.test(secChPlatform)) {
    return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'sec_ch_ua_platform', signals: sig };
  }

  if (sig) {
    if (sig.userAgentDataMobile) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'client_uadata_mobile', signals: sig };
    }
    if (sig.pointerCoarse && sig.hoverNone) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'coarse_pointer_no_hover', signals: sig };
    }
    // iPadOS "Request Desktop Site" presents a Macintosh UA with multi-touch (>1 touch point)
    if (/Macintosh/i.test(effectiveUa) && sig.maxTouchPoints > 1) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'ipad_desktop_mode', signals: sig };
    }
    if (sig.screenWidth > 0 && sig.screenWidth < 1024) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'small_screen_width', signals: sig };
    }
  }

  return { allowed: true, code: null, reason: 'desktop_verified', signals: sig };
}

/**
 * Resolves the external public base URL for Open Graph share previews, sitemaps,
 * and email links. Prevents a local dev PUBLIC_BASE_URL (e.g. http://localhost:8787)
 * from overriding a real deployed or tunneled request host.
 */
export function resolvePublicBaseUrl({ envBaseUrl = '', headers = {}, protocol = 'https', host = '' } = {}) {
  const isLocalHost = h => /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(String(h || '').trim());
  const isLocalOrigin = u => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(String(u || '').trim());

  const hNorm = {};
  for (const [k, v] of Object.entries(headers || {})) {
    hNorm[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }

  const reqHost = String(hNorm['x-forwarded-host'] || hNorm.host || host || '').split(',')[0].trim();
  const reqProtoRaw = String(hNorm['x-forwarded-proto'] || protocol || 'https').split(',')[0].trim().toLowerCase();
  const envClean = String(envBaseUrl || '').trim().replace(/\/$/, '');

  if (envClean && (!isLocalOrigin(envClean) || !reqHost || isLocalHost(reqHost))) {
    return envClean;
  }
  if (reqHost) {
    const proto = isLocalHost(reqHost) ? (reqProtoRaw || 'http') : (reqProtoRaw === 'http' ? 'https' : reqProtoRaw);
    return `${proto}://${reqHost}`;
  }
  return envClean || 'http://localhost:8787';
}

export const sharedRecordedVideos = [];
export const sharedDeletedVideoIds = new Set();

/**
 * Extracts normalized YouTube video metadata from watch, short, live, embed, or youtu.be URLs.
 */
export function parseYouTubeUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = '';
  if (host === 'youtu.be') {
    videoId = u.pathname.replace(/^\/+/, '').split('/')[0];
  } else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    if (u.pathname === '/watch') {
      videoId = u.searchParams.get('v') || '';
    } else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) videoId = m[1];
    }
  } else {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };
}

function normalizeVideoRow(r) {
  if (!r) return null;
  const parsed = parseYouTubeUrl(r.youtube_url || r.youtubeUrl || r.url || r.youtube_id || r.youtubeId);
  const ytId = r.youtube_id || r.youtubeId || parsed?.videoId || '';
  return {
    id: String(r.id),
    title: String(r.title || 'Recorded Session').trim(),
    youtube_url: r.youtube_url || r.youtubeUrl || r.url || parsed?.watchUrl || '',
    youtube_id: ytId,
    embed_url: r.embed_url || r.embedUrl || (ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?rel=0` : ''),
    thumbnail_url: r.thumbnail_url || r.thumbnailUrl || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : ''),
    track: String(r.track || 'all').trim(),
    mode: String(r.mode || 'all').trim(),
    session_number: r.session_number || r.sessionNumber || 'RECORDING',
    duration: r.duration || 'YouTube',
    instructor: r.instructor || 'Plant Green Inertia Mentor',
    summary: r.summary || '',
    created_at: r.created_at || new Date().toISOString()
  };
}

export async function loadRecordedVideos(db) {
  try {
    const { data, error } = await db
      .from('recorded_videos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (!error && Array.isArray(data)) {
      const normalized = data.map(normalizeVideoRow).filter(Boolean);
      sharedRecordedVideos.length = 0;
      sharedRecordedVideos.push(...normalized);
      return normalized;
    }
  } catch {}

  const byId = new Map();
  try {
    const { data: logs } = await db
      .from('admin_audit_logs')
      .select('action,target_id,details,created_at')
      .in('action', ['ADD_RECORDED_VIDEO', 'DELETE_RECORDED_VIDEO'])
      .order('created_at', { ascending: true })
      .limit(1000);
    for (const row of logs || []) {
      if (row.action === 'ADD_RECORDED_VIDEO' && row.details?.id) {
        if (!sharedDeletedVideoIds.has(row.details.id)) {
          byId.set(row.details.id, normalizeVideoRow({ ...row.details, created_at: row.details.created_at || row.created_at }));
        }
      } else if (row.action === 'DELETE_RECORDED_VIDEO' && row.target_id) {
        byId.delete(row.target_id);
      }
    }
  } catch {}

  for (const v of sharedRecordedVideos) {
    if (v?.id && !sharedDeletedVideoIds.has(v.id)) {
      byId.set(v.id, normalizeVideoRow(v));
    }
  }
  return [...byId.values()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

export async function saveRecordedVideo(db, rawRecord) {
  const record = normalizeVideoRow(rawRecord);
  sharedDeletedVideoIds.delete(record.id);
  const idx = sharedRecordedVideos.findIndex(v => v.id === record.id);
  if (idx >= 0) sharedRecordedVideos[idx] = record;
  else sharedRecordedVideos.unshift(record);

  try {
    const { error } = await db.from('recorded_videos').insert(record);
    if (error && !/relation|does not exist|schema cache|PGRST205/i.test(error.message || '')) {
      throw error;
    }
  } catch (err) {
    if (!/relation|does not exist|schema cache|PGRST205/i.test(err?.message || '')) {
      throw err;
    }
  }
  return record;
}

export async function deleteRecordedVideo(db, id) {
  const cleanId = String(id || '').trim();
  sharedDeletedVideoIds.add(cleanId);
  for (let i = sharedRecordedVideos.length - 1; i >= 0; i--) {
    if (sharedRecordedVideos[i]?.id === cleanId) sharedRecordedVideos.splice(i, 1);
  }
  try {
    const { error } = await db.from('recorded_videos').delete().eq('id', cleanId);
    if (error && !/relation|does not exist|schema cache|PGRST205/i.test(error.message || '')) {
      throw error;
    }
  } catch (err) {
    if (!/relation|does not exist|schema cache|PGRST205/i.test(err?.message || '')) {
      throw err;
    }
  }
  return true;
}
