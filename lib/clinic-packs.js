// Industry packs for the AaaS small-business team. Same six screens; only names, labels,
// sample numbers and prompts change. Nothing in a pack sends email, SMS or a payment.
export const HERO = "A small team's work, without hiring one";
export const INR_PER_USD = 84;

const NAMES = [
  'Ananya Reddy', 'Rohan Mehta', 'Fatima Sheikh', 'Karthik Iyer', 'Sneha Kapoor', 'Imran Qureshi',
  'Divya Nair', 'Arjun Deshmukh', 'Lakshmi Rao', 'Vikram Shah', 'Pooja Banerjee', 'Suresh Patil',
  'Kavita Joshi', 'Mohammed Ali', 'Deepa Krishnan', 'Harish Gupta', 'Neha Bansal', 'Ravi Teja',
];
const DAYS = [12, 20, 8, 35, 5, 48, 3, 15, 18, 25, 40, 210, 240, 190, 300, 220, 400, 160];

const agents = (p) => [
  { key: 'front', name: p.front, label: p.frontLabel, kind: 'formfirst', d: p.frontPrompt },
  { key: 'recall', name: p.recallName, label: p.recallLabel, kind: 'nudge', d: p.recallPrompt },
  { key: 'reviews', name: 'Reviews & Referrals', label: 'Review requests', kind: 'afterjob', d: p.reviewPrompt },
  { key: 'social', name: 'Social Media', label: 'Post calendar', kind: 'social', d: p.socialPrompt },
  { key: 'insights', name: 'Owner Insights', label: 'Weekly numbers', kind: 'finance', d: p.insightsPrompt },
  { key: 'billing', name: 'Billing & Invoicing', label: 'Invoices and reminders', kind: 'finance', d: p.billingPrompt },
];

function pack(p) {
  return {
    ...p,
    agents: agents(p),
    people: NAMES.map((name, i) => ({ name, days: DAYS[i], value: p.values[i] })),
  };
}

const review = (noun) => `Drafts a review request as a WhatsApp click-to-chat link after a ${noun}. No SMS and no paid WhatsApp API. The owner approves it first.`;
const social = (what) => `Plans ${what} on a weekly calendar in the owner's voice, creates the images and captions, and publishes them to Instagram (and X, LinkedIn or Facebook when connected) after the owner approves. Replies to comments and messages about the business, and engages with relevant local posts to promote it. Every public post, comment or reply waits for the owner's approval unless the owner sets a rule, with a daily limit that protects the account.`;
const insights = 'Shows the week in plain numbers, including what was paid on invoices, so the owner can see if the business made money.';
const billing = (what) => `Creates a manual invoice for ${what}. GST stays blank unless the owner types a rate. There is no GSTIN. Payment reminders are drafts with a WhatsApp link and an email draft. Nothing is sent and nothing is charged.`;

export const PACKS = {
  // Digital marketing agency: the first tile on the onboarding page.
  marketing: pack({
    id: 'marketing', title: 'Digital marketing agency', blurb: 'Leads, proposals, retainers, client reports and invoices for an agency.',
    who: 'clients', whoSingular: 'client', visit: 'strategy call',
    booking: 'Calls this week', noshow: 'Missed calls', recall: 'Retainers due', revenue: 'Paid this month',
    pitch: 'Your agency never drops a lead, a proposal follow-up or a retainer renewal, and you see every week what clients actually paid.',
    biz: 'Pixel Growth (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 60000,
    services: 'SEO, Social media management, Google Ads', prices: 'SEO retainer ₹25,000 · Social media ₹18,000 · Ads management ₹15,000',
    audience: 'Local business owners who want more leads',
    offer: 'Free marketing audit',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Pixel%20Growth&cu=INR',
    tone: 'Clear and numbers-first, the way you write to a client',
    vertical: 'marketing_agency', verticalLabel: 'Digital marketing agency',
    front: 'Front Desk', frontLabel: 'Leads and strategy calls',
    frontPrompt: 'Takes new-business enquiries, qualifies the lead (budget, goal, timeline) and books a strategy call. Proposal follow-ups wait for approval.',
    recallName: 'Client Follow-up', recallLabel: 'Quiet leads and retainers up for renewal',
    recallPrompt: 'Lists leads who went quiet after a proposal and retainers that are due for renewal, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('campaign report'), socialPrompt: social('agency posts and case studies'), insightsPrompt: insights, billingPrompt: billing('a retainer or project'),
    visitName: 'Strategy call', cleanName: 'SEO retainer', followName: 'Monthly report review',
    place: 'agency',
    post1: 'two free marketing audits open this week',
    post2: 'a short case study: what 90 days of local SEO did for one client',
    enquiry: 'Need more leads from Google and Instagram. What would it cost?',
    values: [18000, 25000, 15000, 75000, 12000, 30000, 90000, 20000, 45000, 150000, 120000, 25000, 18000, 36000, 96000, 180000, 15000, 28000],
    fees: [0, 25000, 0, 18000, 15000, 40000],
    suggest: {
      services: ['SEO', 'Social media management', 'Google Ads', 'Meta Ads', 'Content marketing', 'Website design', 'Branding', 'Email marketing', 'Video editing', 'Influencer marketing'],
      audience: ['Local business owners', 'Startups and founders', 'E-commerce brands', 'Clinics and hospitals', 'Real estate developers', 'Restaurants and cafes', 'Coaching institutes', 'D2C brands'],
      offers: ['Free marketing audit', 'Free 30-minute strategy call', '10% off the first 3 months', 'Free website health report', '₹5000 off annual retainer', 'Refer a business: 1 month free'],
    },
  }),
  dental: pack({
    suggest: { services: ['Check-up', 'Scaling and cleaning', 'Root canal treatment', 'Fillings', 'Teeth whitening', 'Braces and aligners', 'Dental implants', 'Tooth extraction', 'Kids dentistry', 'Crowns and bridges'],
      audience: ['Families nearby', 'Working professionals', 'Parents of school children', 'Senior citizens', 'Brides and grooms', 'Patients overdue for a check-up'],
      offers: ['10% off first visit', 'Free consultation', 'Free dental check-up camp', 'Family check-up: 4th member free', '₹500 off teeth whitening', 'Refer a friend: ₹500 off'] },
    id: 'dental', title: 'Dental clinic', blurb: 'Enquiries, recall, reviews, social and invoices for a private clinic.',
    who: 'patients', whoSingular: 'patient', visit: 'visit',
    booking: 'Bookings this week', noshow: 'No-shows', recall: 'Recalls due', revenue: 'Paid this month',
    pitch: 'Your clinic never misses an enquiry, a follow-up or a review, and you see every week whether you are making money.',
    biz: 'Smile Dental (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 20000,
    services: 'Check-up, cleaning, RCT review', prices: 'Check-up ₹1,200 · Cleaning ₹1,500 · RCT review ₹8,200',
    audience: 'Families within 5 km who already have a dentist and skip recall visits',
    offer: 'A cleaning slot this week, confirmed by the desk after you approve the reminder',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Smile%20Dental&cu=INR',
    tone: 'Warm and short, the way you speak to patients',
    vertical: 'clinic_dental', verticalLabel: 'Clinic: dental',
    front: 'Front Desk', frontLabel: 'Enquiries and bookings',
    frontPrompt: 'Takes enquiries and books appointments alongside reception. Does not replace the receptionist. No IVR. Reminders wait for approval and are not sent from here.',
    recallName: 'Patient Recall', recallLabel: 'Lapsed and high-value patients',
    recallPrompt: 'Lists patients who have not been back and patients with a high bill, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('visit'), socialPrompt: social('clinic posts'), insightsPrompt: insights, billingPrompt: billing('a treatment'),
    visitName: 'Check-up', cleanName: 'Cleaning', followName: 'RCT review',
    place: 'clinic',
    post1: 'open cleaning slots this weekend',
    post2: 'a short note on why a six-month check-up matters',
    enquiry: 'Tooth pain, hoping for an appointment.',
    values: [4500, 6000, 3500, 9000, 2200, 7000, 5000, 2800, 15000, 32000, 41000, 8000, 5400, 12000, 26000, 45000, 3000, 6400],
    fees: [1500, 8000, 1200, 1500, 2000, 2500],
  }),
  aesthetic: pack({
    suggest: { services: ['Skin consultation', 'Hair consultation', 'Acne treatment', 'Laser hair removal', 'Chemical peel', 'Hydrafacial', 'PRP hair treatment', 'Hair transplant', 'Anti-ageing treatment', 'Glow package'],
      audience: ['Working professionals', 'Brides and grooms', 'College students', 'New mothers', 'Men with hair loss', 'People with acne concerns'],
      offers: ['Free skin consultation', '10% off first treatment', '15% off bridal package', 'Buy 5 sessions and get 1 free', '₹1000 off laser package', 'Refer a friend: ₹500 off'] },
    id: 'aesthetic', title: 'Skin, hair and aesthetic clinic', blurb: 'Consults, packages and review requests for a skin or hair clinic.',
    who: 'clients', whoSingular: 'client', visit: 'consult',
    booking: 'Consults this week', noshow: 'Missed consults', recall: 'Packages due', revenue: 'Paid this month',
    pitch: 'Your clinic keeps every consult, package follow-up and review, and you see what was actually paid.',
    biz: 'Glow Aesthetic (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 15000,
    services: 'Skin consult, hair consult, glow package', prices: 'Consult ₹1,500 · Glow package ₹12,000',
    audience: 'Adults booking skin and hair care, mostly on Instagram',
    offer: 'A consult this week. The desk confirms it after you approve.',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Glow%20Aesthetic&cu=INR',
    tone: 'Calm and plain, no medical claims',
    vertical: 'clinic_aesthetic', verticalLabel: 'Clinic: skin and hair',
    front: 'Front Desk', frontLabel: 'Enquiries and consults',
    frontPrompt: 'Takes consult enquiries and holds a slot beside the front desk. Does not replace reception. No IVR. Reminders wait for approval.',
    recallName: 'Package Follow-up', recallLabel: 'Lapsed and high-value clients',
    recallPrompt: 'Lists clients who have not been back and clients on a high package, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('consult'), socialPrompt: social('treatment posts'), insightsPrompt: insights, billingPrompt: billing('a package'),
    visitName: 'Skin consult', cleanName: 'Glow package', followName: 'Hair consult',
    place: 'clinic',
    post1: 'two glow-package consults open this week',
    post2: 'a plain note on what a skin consult includes',
    enquiry: 'Asking about a skin consult this week.',
    values: [4500, 6000, 3500, 18000, 2200, 7000, 16000, 2800, 15000, 32000, 41000, 8000, 5400, 12000, 26000, 45000, 3000, 6400],
    fees: [1500, 12000, 1500, 1500, 2000, 2500],
  }),
  coach: pack({
    suggest: { services: ['Discovery call', 'One-to-one coaching', 'Group coaching', 'Monthly retainer', 'Workshop', 'Business consulting', 'Career coaching', 'Leadership coaching', 'Online course'],
      audience: ['Founders and business owners', 'Working professionals', 'Mid-career managers', 'Students and freshers', 'Sales teams', 'Women entrepreneurs'],
      offers: ['Free discovery call', '10% off first month', '₹2000 off 3-month programme', 'Bring a friend: 20% off workshop', 'Free goal-setting session'] },
    id: 'coach', title: 'Coach or consultant', blurb: 'Discovery calls, follow-ups and invoices for a solo coach.',
    who: 'clients', whoSingular: 'client', visit: 'session',
    booking: 'Sessions this week', noshow: 'Missed sessions', recall: 'Clients gone quiet', revenue: 'Paid this month',
    pitch: 'Your practice does not drop a lead or a session follow-up, and you see which invoices were paid.',
    biz: 'North Consulting (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 50000,
    services: 'Discovery call, monthly retainer, workshop', prices: 'Discovery ₹0 · Retainer ₹25,000 · Workshop ₹16,000',
    audience: 'Founders of small firms who want a weekly operating rhythm',
    offer: 'A 30-minute discovery call. You approve the invite before it is drafted out.',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=North%20Consulting&cu=INR',
    tone: 'Direct and useful, like a note to a client',
    vertical: 'coach', verticalLabel: 'Coach or consultant',
    front: 'Client Desk', frontLabel: 'Enquiries and sessions',
    frontPrompt: 'Takes enquiries and holds discovery calls. The owner still decides what goes out. No IVR.',
    recallName: 'Client Follow-up', recallLabel: 'Quiet and high-value clients',
    recallPrompt: 'Lists clients who have gone quiet and high-value retainers, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('session'), socialPrompt: social('practice posts'), insightsPrompt: insights, billingPrompt: billing('a session or retainer'),
    visitName: 'Discovery call', cleanName: 'Retainer check-in', followName: 'Workshop',
    place: 'practice',
    post1: 'one discovery call open for founders this week',
    post2: 'a short note on what a retainer week looks like',
    enquiry: 'Looking for a discovery call this week.',
    values: [15000, 25000, 8000, 60000, 5000, 20000, 55000, 12000, 40000, 120000, 90000, 18000, 10000, 30000, 80000, 150000, 7000, 22000],
    fees: [0, 25000, 0, 0, 15000, 5000],
  }),
  realestate: pack({
    suggest: { services: ['2BHK flats', '3BHK flats', 'Villas', 'Open plots', 'Commercial space', 'Rentals', 'Site visits', 'Home loan assistance', 'Resale homes'],
      audience: ['First-time home buyers', 'Families upgrading homes', 'NRI investors', 'IT professionals', 'Property investors', 'Tenants looking to rent'],
      offers: ['Free site visit with pickup', 'No brokerage this month', 'Free home loan assistance', '₹25000 off booking amount', 'Refer a buyer: ₹10000 reward'] },
    id: 'realestate', title: 'Real estate', blurb: 'The same screens for a desk that follows buyer leads.',
    who: 'leads', whoSingular: 'lead', visit: 'site visit',
    booking: 'Site visits this week', noshow: 'Missed follow-ups', recall: 'Leads gone cold', revenue: 'Paid this month',
    pitch: 'Your desk never misses a lead, a follow-up or a review, and you see what has actually been paid.',
    biz: 'Sample Realty', city: 'Hyderabad', phone: '919000000000', highValue: 10000000,
    services: '2BHK viewing, site visit, follow-up call', prices: 'Site visit ₹0 · Booking token as agreed on the invoice',
    audience: 'Families comparing 2BHK homes in this city',
    offer: 'A site visit this week. The desk confirms after you approve the message.',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Sample%20Realty&cu=INR',
    tone: 'Short and specific, one property at a time',
    vertical: 'real_estate', verticalLabel: 'Real estate',
    front: 'Lead Desk', frontLabel: 'Enquiries and site visits',
    frontPrompt: 'Takes buyer enquiries and books site visits. Hands the conversation to the desk. Reminders wait for approval.',
    recallName: 'Lead Follow-up', recallLabel: 'Cold and high-value leads',
    recallPrompt: 'Lists leads who have gone quiet and high-value leads, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('site visit'), socialPrompt: social('listing posts'), insightsPrompt: insights, billingPrompt: billing('a booking token'),
    visitName: 'Site visit', cleanName: '2BHK viewing', followName: 'Follow-up call',
    place: 'desk',
    post1: 'a 2BHK viewing open this weekend',
    post2: 'one line on what to bring to a site visit',
    enquiry: 'Looking at a 2BHK this week.',
    values: [4500000, 6200000, 3800000, 5100000, 2900000, 7400000, 4300000, 3600000, 8000000, 22000000, 18500000, 4100000, 3900000, 5600000, 24000000, 31000000, 2700000, 4800000],
    fees: [500000, 800000, 350000, 0, 420000, 250000],
  }),
  studio: pack({
    suggest: { services: ['Haircut', 'Hair colour', 'Facial', 'Bridal makeup', 'Gym membership', 'Personal training', 'Yoga classes', 'Zumba classes', 'Class pack', 'Spa and massage'],
      audience: ['Working professionals', 'College students', 'Homemakers', 'Brides and grooms', 'Fitness beginners', 'Members who stopped coming'],
      offers: ['First class free', '10% off first visit', '20% off annual membership', 'Bring a friend: 1 week free', '₹500 off bridal package', 'Refer a friend: ₹300 off'] },
    id: 'studio', title: 'Salon, gym or studio', blurb: 'Class bookings, memberships and reminders for a studio.',
    who: 'members', whoSingular: 'member', visit: 'session',
    booking: 'Sessions this week', noshow: 'No-shows', recall: 'Memberships lapsing', revenue: 'Paid this month',
    pitch: 'Your studio keeps the booking, the membership reminder and the review, and you see what was paid.',
    biz: 'Forma Studio (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 8000,
    services: 'Haircut, class pack, personal session', prices: 'Haircut ₹800 · Class pack ₹6,000 · Session ₹1,500',
    audience: 'Members who come weekly and drop off after a month',
    offer: 'A session this week. You approve the reminder before it is queued.',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Forma%20Studio&cu=INR',
    tone: 'Friendly and brief',
    vertical: 'studio', verticalLabel: 'Salon, gym or studio',
    front: 'Front Desk', frontLabel: 'Enquiries and sessions',
    frontPrompt: 'Takes class and appointment enquiries beside the front desk. Does not replace the desk. No IVR. Reminders wait for approval.',
    recallName: 'Membership Follow-up', recallLabel: 'Lapsed and high-value members',
    recallPrompt: 'Lists members who have not been in and members on a high pack, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('session'), socialPrompt: social('class posts'), insightsPrompt: insights, billingPrompt: billing('a membership'),
    visitName: 'Class', cleanName: 'Haircut', followName: 'Personal session',
    place: 'studio',
    post1: 'two class spots open this week',
    post2: 'a short note for members who missed a week',
    enquiry: 'Want a class or appointment this week.',
    values: [2500, 6000, 1800, 9000, 1200, 4000, 8500, 2000, 7000, 15000, 12000, 3000, 2200, 5000, 11000, 16000, 1500, 4500],
    fees: [800, 6000, 1500, 800, 1500, 2000],
  }),
  home: pack({
    suggest: { services: ['Site visit', 'Full home interiors', 'Modular kitchen', 'Wardrobes', 'Living room design', 'Painting', 'False ceiling', 'Renovation', '3D design'],
      audience: ['New home owners', 'Families renovating', 'Apartment buyers', 'Villa owners', 'Office and shop owners', 'Builders and architects'],
      offers: ['Free site visit', 'Free 3D design', '10% off modular kitchen', '₹10000 off full home interiors', 'Refer a friend: ₹5000 off'] },
    id: 'home', title: 'Interior design and home services', blurb: 'Site visits, quotes and invoices for a home business.',
    who: 'customers', whoSingular: 'customer', visit: 'site visit',
    booking: 'Visits this week', noshow: 'Missed visits', recall: 'Quotes gone quiet', revenue: 'Paid this month',
    pitch: 'Your desk does not drop a site visit, a quote follow-up or a review, and you see which invoices were paid.',
    biz: 'Hearth Interiors (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 100000,
    services: 'Site visit, design quote, install visit', prices: 'Site visit ₹0 · Design quote from ₹25,000',
    audience: 'Homeowners renovating one room, not a full building',
    offer: 'A site visit this week. The quote stays a draft until you approve it.',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Hearth%20Interiors&cu=INR',
    tone: 'Practical and specific about the room',
    vertical: 'home_services', verticalLabel: 'Interior design and home services',
    front: 'Job Desk', frontLabel: 'Enquiries and site visits',
    frontPrompt: 'Takes job enquiries and holds site visits. The owner approves every outbound note. No IVR.',
    recallName: 'Quote Follow-up', recallLabel: 'Quiet and high-value jobs',
    recallPrompt: 'Lists quotes that have gone quiet and high-value jobs, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('install'), socialPrompt: social('project posts'), insightsPrompt: insights, billingPrompt: billing('a job'),
    visitName: 'Site visit', cleanName: 'Design quote', followName: 'Install visit',
    place: 'business',
    post1: 'one room visit open this week',
    post2: 'a plain note on how a design quote is scoped',
    enquiry: 'Want a site visit for one room.',
    values: [20000, 45000, 8000, 120000, 5000, 30000, 150000, 12000, 80000, 250000, 180000, 15000, 10000, 40000, 200000, 320000, 7000, 28000],
    fees: [0, 25000, 0, 0, 15000, 8000],
  }),
  institute: pack({
    suggest: { services: ['Trial class', 'School tuitions', 'IIT-JEE coaching', 'NEET coaching', 'Spoken English', 'Coding classes', 'Competitive exam coaching', 'Crash course', 'Online batch'],
      audience: ['Parents of school children', 'Class 10 students', 'Class 11 and 12 students', 'College students', 'Job seekers', 'Working professionals'],
      offers: ['Free trial class', '10% off first month fee', 'Sibling discount: 15% off', '₹1000 off early admission', 'Refer a friend: ₹500 off'] },
    id: 'institute', title: 'Coaching institute', blurb: 'Admissions, fee reminders and parent follow-ups for a coaching centre.',
    who: 'students', whoSingular: 'student', visit: 'class',
    booking: 'Classes this week', noshow: 'Absences', recall: 'Fees and drop-offs due', revenue: 'Paid this month',
    pitch: 'Your centre does not miss an admission, a fee reminder or a review, and you see which fees were paid.',
    biz: 'Ladder Institute (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 20000,
    services: 'Trial class, monthly fee, parent call', prices: 'Class ₹500 · Monthly fee ₹8,200',
    audience: 'Parents choosing a weekly batch for one subject',
    offer: 'A trial class this week. The fee reminder waits for your approval.',
    upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Ladder%20Institute&cu=INR',
    tone: 'Clear for a parent, short enough to read on a phone',
    vertical: 'institute', verticalLabel: 'Coaching institute',
    front: 'Admissions Desk', frontLabel: 'Enquiries and trials',
    frontPrompt: 'Takes admission enquiries and holds trial classes beside the desk. Does not replace the counsellor. No IVR. Reminders wait for approval.',
    recallName: 'Batch Follow-up', recallLabel: 'Absent and high-fee students',
    recallPrompt: 'Lists students who have missed classes and high-fee batches, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('batch'), socialPrompt: social('batch posts'), insightsPrompt: insights, billingPrompt: billing('a fee'),
    visitName: 'Trial class', cleanName: 'Monthly fee', followName: 'Parent call',
    place: 'centre',
    post1: 'a trial class seat open this week',
    post2: 'a short note for parents comparing one batch',
    enquiry: 'Asking about a trial class this week.',
    values: [8000, 16000, 5000, 24000, 4000, 12000, 22000, 6000, 18000, 40000, 36000, 9000, 7000, 15000, 28000, 48000, 3000, 11000],
    fees: [500, 8000, 500, 500, 2000, 2500],
  }),
  // Any business that is not listed above. The owner types the kind of business on the onboarding page.
  other: pack({
    suggest: { services: ['Consultation', 'Standard service', 'Premium service', 'Home visit', 'Follow-up', 'Annual plan'],
      audience: ['Families nearby', 'Working professionals', 'Students', 'Senior citizens', 'Local businesses', 'Repeat customers'],
      offers: ['10% off first visit', 'Free consultation', '₹200 off first order', 'Refer a friend: ₹500 off', 'Festival offer: 15% off'] },
    id: 'other', title: 'Other business', blurb: 'Enquiries, follow-ups, reviews, social and invoices for any small business.',
    who: 'customers', whoSingular: 'customer', visit: 'appointment',
    booking: 'Appointments this week', noshow: 'Missed appointments', recall: 'Customers gone quiet', revenue: 'Paid this month',
    pitch: 'Your business does not miss an enquiry, a follow-up or a review, and you see every week whether you are making money.',
    biz: 'Your Business (sample)', city: 'Hyderabad', phone: '919000000000', highValue: 20000,
    services: 'Consultation, standard service, follow-up', prices: 'Consultation ₹500 · Service ₹2,000',
    audience: 'Local customers who want a quick, reliable answer',
    offer: '', upi: 'sample@upi', payLink: 'upi://pay?pa=sample@upi&pn=Your%20Business&cu=INR',
    tone: 'Friendly and short, like a message from the owner',
    vertical: 'other', verticalLabel: 'Other business',
    front: 'Front Desk', frontLabel: 'Enquiries and appointments',
    frontPrompt: 'Takes enquiries and holds appointments beside the desk. The owner still decides what goes out. No IVR.',
    recallName: 'Customer Follow-up', recallLabel: 'Quiet and high-value customers',
    recallPrompt: 'Lists customers who have gone quiet and high-value customers, and drafts a follow-up for the owner to approve.',
    reviewPrompt: review('visit'), socialPrompt: social('business posts'), insightsPrompt: insights, billingPrompt: billing('a service'),
    visitName: 'Consultation', cleanName: 'Standard service', followName: 'Follow-up',
    place: 'business',
    post1: 'an appointment slot open this week',
    post2: 'a short note on what customers ask most',
    enquiry: 'Asking about an appointment this week.',
    values: [2000, 5000, 1500, 8000, 1000, 3000, 7000, 2500, 6000, 15000, 12000, 4000, 1800, 4500, 10000, 20000, 900, 3500],
    fees: [500, 2000, 500, 500, 1000, 800],
  }),
};

export const PACK_IDS = Object.keys(PACKS);

// Domain-specific URLs. Each industry pack is served at its own path: a pack can set `path` explicitly,
// otherwise it is "/" + the id with a capital first letter (realestate -> /Realestate). Dental keeps /clinic.
// New packs get a URL automatically; paths that would shadow app routes are refused at load time.
const PATH_OVERRIDES = { dental: '/clinic' };
const RESERVED = new Set(['', 'api', 'p', 't', 'c', 'book', 'setup', 'settings', 'board', 'waitlist', 'zips', 'logos', 'v1', 'index', 'public', 'assets']);
export const PACK_PATHS = Object.fromEntries(PACK_IDS.map((id) => {
  const raw = PACKS[id].path || PATH_OVERRIDES[id] || '/' + id.charAt(0).toUpperCase() + id.slice(1);
  const p = '/' + String(raw).replace(/^\/+|\/+$/g, '');
  if (!/^\/[A-Za-z][A-Za-z0-9-]{1,40}$/.test(p) || RESERVED.has(p.slice(1).toLowerCase())) throw new Error(`clinic pack "${id}" has an unusable URL path "${p}"`);
  return [id, p];
}));
if (new Set(Object.values(PACK_PATHS).map((p) => p.toLowerCase())).size !== PACK_IDS.length) throw new Error('two clinic packs share a URL path');
export function packPath(id) { return PACK_PATHS[id] || '/clinic'; }
// The clinic-visit interview kit is written for clinics (patients, clinic software, reception). A pack opts in with
// visitKit: true; any pack without it (and every new pack by default) has no Clinic visit screen.
const VISIT_KIT = new Set(['dental', 'aesthetic']);
export function hasVisitKit(id) { const p = PACKS[id]; return !!p && (p.visitKit === true || (p.visitKit !== false && VISIT_KIT.has(id))); }
// "/realestate", "/Realestate/" or "/Realestate.html" -> "realestate"; unknown paths -> ''
export function packForPath(pathname) {
  const p = '/' + String(pathname || '').replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '').toLowerCase();
  if (p === '/clinic') return 'dental';
  return PACK_IDS.find((id) => PACK_PATHS[id].toLowerCase() === p) || '';
}
export const AGENT_KEYS = ['front', 'recall', 'reviews', 'social', 'insights', 'billing'];
export function packOf(id) { return PACKS[id] || null; }
export function publicPacks() {
  return PACK_IDS.map((id) => {
    const p = PACKS[id];
    const list = (v) => String(v || '').split(/,|·/).map((x) => x.replace(/₹.*$/, '').trim()).filter((x) => x && x.length < 60).slice(0, 6);
    return { id, title: p.title, blurb: p.blurb, path: PACK_PATHS[id], visitKit: hasVisitKit(id), agents: p.agents.map((a) => a.name), who: p.who,
      labels: { who: p.who, whoSingular: p.whoSingular, visit: p.visit, place: p.place || 'business' },
      suggest: { services: (p.suggest && p.suggest.services) || list(p.services), audience: (p.suggest && p.suggest.audience) || [], offers: (p.suggest && p.suggest.offers) || [] } };
  });
}

// "Other" businesses: the words follow what the owner typed ("Bakery" gets orders, not appointments).
const OTHER_WORDS = [
  [/baker|cake|sweet|restaurant|cafe|café|hotel|cater|tiffin|food|kitchen|dairy|juice|shop|store|boutique|mart|pharmac|medical store|kirana|grocer|jewel|mobile|electronic|florist|flower|garment|cloth|textile|print|furniture|hardware|stationer|book|gift|toy|optical|tailor/i,
    { visit: 'order', booking: 'Orders this week', noshow: 'Cancelled orders', bookAction: 'New order', frontLabel: 'Enquiries and orders', visitName: 'Order', post1: 'fresh stock and this week’s specials' }],
  [/clinic|doctor|physio|vet|pet|lab|diagnos|hospital|therap|nurs|ayurved|homeo|eye|ortho/i,
    { visit: 'appointment', booking: 'Appointments this week', noshow: 'Missed appointments', bookAction: 'Book appointment', frontLabel: 'Enquiries and appointments', visitName: 'Appointment', post1: 'slots open this week' }],
];
const OTHER_DEFAULT = { visit: 'booking', booking: 'Bookings this week', noshow: 'Cancelled bookings', bookAction: 'New booking', frontLabel: 'Enquiries and bookings', visitName: 'Booking', post1: 'what is new this week' };
export function otherWords(businessType) {
  const t = String(businessType || '');
  for (const [re, w] of OTHER_WORDS) if (re.test(t)) return w;
  return OTHER_DEFAULT;
}
