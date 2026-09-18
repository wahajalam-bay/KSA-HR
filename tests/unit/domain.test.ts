import {
  STAGE_KEYS, STAGE_INDEX, FIXED, PICKABLE, isEntry, isFixed,
  nextStage, previousStage, isForward, inSpineOrder, slaOf, type JobStage,
} from '@/lib/domain/stages';
import * as score from '@/lib/domain/score';
import {
  moneyIn, noticeIn, yearsIn, arabicIn, scoreAnswer, screenQuestions,
  ARABIC_FAMILIES,
} from '@/lib/domain/screening';
import { fit, fitBandOf, fitLabelOf } from '@/lib/domain/cv-fit';
import { readSector, sectorOfCompany, SECTOR_KEYS } from '@/lib/domain/sector';
import {
  addMonths, daysLeft, probationState, isDecided, PROBATION_MONTHS,
} from '@/lib/domain/probation';
import {
  CLAIM_DEFAULT_DAYS, claimEndsAt, claimIsLive, claimDaysLeft, readClaimDays,
} from '@/lib/domain/claim';
import { CRIT, CRIT_KEYS, scoreFrom, band, bandText, isFlagged } from '@/lib/domain/ivreview';
import { ok, eq as equals, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   The arithmetic, on its own.

   Everything in lib/domain is a pure function: no database, no clock it did not
   receive, no provider. That is deliberate, because these are the numbers every
   chart in the product reports, and a figure that is wrong here is wrong on the
   board, on the card, in Insights and in the letter at the same time — with
   nothing to compare it against.

   So they are tested here in isolation, against the cases that actually occur:
   the boundary of an SLA, an unanswered knockout, a salary written as "18k", a
   probation that ends on the last day of a short month.
   ───────────────────────────────────────────────────────────────────────────*/

const loop = (keys: string[]): JobStage[] =>
  keys.map((k, i) => ({ stageKey: k as 'applied', name: k, sla: 3, ordinal: STAGE_INDEX[k as 'applied'] ?? i }));

const suite: Suite = {
  name: 'unit · the arithmetic',
  tests: [
    /* ── The spine ──────────────────────────────────────────────────────── */
    {
      name: 'the spine is ten stages in one order, and four of them are fixed',
      fn() {
        equals(STAGE_KEYS.length, 10);
        equals(STAGE_KEYS[0], 'applied');
        equals(STAGE_KEYS[STAGE_KEYS.length - 1], 'joined');
        equals(FIXED.join(','), 'applied,sourced,offer,joined');
        equals(PICKABLE.join(','), 'screen,assessment,iv1,iv2,pitch,ivf');
        for (const k of FIXED) ok(isFixed(k), `${k} is fixed`);
        /* Every key has a place, and no two share one. */
        equals(new Set(Object.values(STAGE_INDEX)).size, STAGE_KEYS.length);
      },
    },
    {
      name: 'a loop out of order is put back into spine order',
      fn() {
        const shuffled = loop(['offer', 'applied', 'ivf', 'screen']);
        equals(inSpineOrder(shuffled).map((s) => s.stageKey).join(','),
          'applied,screen,ivf,offer');
      },
    },
    {
      name: 'applied and sourced are alternatives, so advancing skips the other',
      fn() {
        const l = loop(['applied', 'sourced', 'screen', 'iv1', 'offer', 'joined']);
        equals(nextStage(l, 'applied'), 'screen', 'out of Applied, past Sourced');
        equals(nextStage(l, 'sourced'), 'screen', 'and out of Sourced, past nothing');
        ok(isEntry('applied') && isEntry('sourced'), 'both are entries');
      },
    },
    {
      name: 'advancing runs out at the end, and back at the beginning',
      fn() {
        const l = loop(['applied', 'screen', 'offer', 'joined']);
        equals(nextStage(l, 'joined'), null, 'nothing follows Joined');
        equals(previousStage(l, 'applied'), null, 'and nothing precedes Applied');
        equals(nextStage(l, 'iv2'), null, 'a stage this loop does not run has no next');
        ok(isForward(l, 'applied', 'offer'), 'forward is forward');
        ok(!isForward(l, 'offer', 'applied'), 'and back is not');
      },
    },

    /* ── The SLA ────────────────────────────────────────────────────────── */
    {
      name: 'an SLA is ok, then due at seven tenths, then over past it',
      fn() {
        equals(slaOf(0, 5).state, 'ok');
        equals(slaOf(3, 5).state, 'ok', 'three of five is still comfortable');
        equals(slaOf(4, 5).state, 'due', 'four of five is the warning band');
        equals(slaOf(5, 5).state, 'due', 'on the day is due, not yet over');
        equals(slaOf(6, 5).state, 'over', 'the day after is over');
        equals(slaOf(10, 0).sla, 5, 'a stage with no SLA falls back to five days');
      },
    },

    /* ── Scores out of a maximum ────────────────────────────────────────── */
    {
      name: 'a score is a percentage of its own maximum, and bands consistently',
      fn() {
        equals(score.pct(6, 12), 50);
        equals(score.pct(12, 12), 100);
        /* A scored thing never reads zero, because "0 of 100" is what an
           unscored thing looks like and the two mean different things to a
           panel. The floor is one; a single criterion that genuinely is a zero
           asks for the raw number. */
        equals(score.pct(0, 12), 1, 'a scored nothing reads one, not nought');
        equals(score.pct(0, 12, { raw: true }), 0, 'and raw gives the real figure');
        equals(score.pct(5, 0), null, 'out of nothing is not a percentage');
        equals(score.pct(null, 12), null, 'and unscored is null, not nought');

        equals(score.band(100)[0], 'Great');
        equals(score.band(0)[0], 'Poor');
        /* The bands cover the whole range with no gap and no overlap. */
        const seen = new Set<string>();
        for (let n = 0; n <= 100; n += 1) {
          const [b, t] = score.band(n);
          ok(b, `${n} has a band`);
          ok(['ok', 'warn', 'bad'].includes(t), `${n} has a tone`);
          seen.add(b);
        }
        equals(seen.size, 5, 'five bands, all reachable');
        equals(score.label(null), '—', 'and nothing scored says so');
      },
    },

    /* ── Reading an answer ──────────────────────────────────────────────── */
    {
      name: 'money is read however a person writes it',
      fn() {
        equals(moneyIn('18000').join(','), '18000');
        equals(moneyIn('18,000 SAR').join(','), '18000');
        equals(moneyIn('18k').join(','), '18000');
        equals(moneyIn('between 16k and 20k').join(','), '16000,20000');
        equals(moneyIn('no idea').length, 0, 'and a non-answer is no number');
      },
    },
    {
      name: 'a notice period is read in whatever unit it was given',
      fn() {
        equals(noticeIn('30 days'), 30);
        equals(noticeIn('one month'), 30);
        equals(noticeIn('2 months'), 60);
        equals(noticeIn('immediate'), 0);
        equals(noticeIn('I can start right away'), 0);
        equals(noticeIn('not sure'), null, 'and an unclear answer is not a number');
      },
    },
    {
      name: 'Arabic is read as a level, not a yes or no',
      fn() {
        equals(arabicIn('native Arabic speaker'), 'Native');
        equals(arabicIn('fluent in Arabic and English'), 'Fluent');
        equals(arabicIn('conversational'), 'Conversational');
        equals(arabicIn('a few words'), 'Basic');
        equals(arabicIn('no Arabic'), 'None');
        equals(arabicIn('I like cricket'), null);
      },
    },
    {
      name: 'an unanswered knockout scores nothing, not the middle',
      fn() {
        const c: Parameters<typeof scoreAnswer>[2] = {
          jobTitle: 'Property Consultant', family: 'Sales', city: 'Riyadh',
          remoteOk: false, salaryMin: 12000, salaryMax: 18000,
          arabicMatters: true, wantsYears: 3,
        };
        for (const key of ['location', 'right_to_work', 'notice', 'salary', 'arabic', 'experience'] as const) {
          equals(scoreAnswer(key, '', c), 0, `${key}: a blank answer is a miss`);
          equals(scoreAnswer(key, '   ', c), 0, `${key}: and so is whitespace`);
        }
      },
    },
    {
      name: 'a salary inside the band scores full, just over scores half, well over scores nothing',
      fn() {
        const c: Parameters<typeof scoreAnswer>[2] = {
          jobTitle: 'Consultant', family: 'Sales', city: 'Riyadh',
          remoteOk: false, salaryMin: 14000, salaryMax: 20000,
          arabicMatters: false, wantsYears: 3,
        };
        equals(scoreAnswer('salary', '18k', c), 2, 'inside the band');
        equals(scoreAnswer('salary', '20000', c), 2, 'at the top of it');
        equals(scoreAnswer('salary', '22k', c), 1, 'within a sixth over');
        equals(scoreAnswer('salary', '30k', c), 0, 'half again is a no');
      },
    },
    {
      name: 'Arabic costs more where the job is customer-facing',
      fn() {
        const base = {
          jobTitle: 'Consultant', family: 'Sales', city: 'Riyadh',
          remoteOk: false, salaryMin: 14000, salaryMax: 20000, wantsYears: 3,
        };
        const sells: Parameters<typeof scoreAnswer>[2] = { ...base, arabicMatters: true };
        const desk: Parameters<typeof scoreAnswer>[2] = { ...base, arabicMatters: false };
        equals(scoreAnswer('arabic', 'conversational', sells), 1);
        equals(scoreAnswer('arabic', 'conversational', desk), 2, 'where it does not matter, it is fine');
        equals(scoreAnswer('arabic', 'a few words', sells), 0);
        equals(scoreAnswer('arabic', 'native', sells), 2, 'and native is full marks either way');
        ok(ARABIC_FAMILIES.includes('Sales'), 'sales is one of the families it matters in');
      },
    },
    {
      name: 'the six questions are asked of everybody, worded for the requisition',
      fn() {
        const qs = screenQuestions({
          jobTitle: 'Property Consultant', family: 'Sales', city: 'Jeddah',
          remoteOk: false, salaryMin: 12000, salaryMax: 18000,
        });
        equals(qs.length, 6, 'six, always');
        equals(new Set(qs.map((q) => q.key)).size, 6, 'each asked once');
        ok(qs.every((q) => q.max === 2), 'each out of two');
        ok(qs.some((q) => q.question.includes('Jeddah')), 'and worded for the city');
      },
    },

    /* ── Fit against the bar ────────────────────────────────────────────── */
    {
      name: 'fit rewards the skills the requisition asked for',
      fn() {
        const job = {
          title: 'Senior Property Consultant', family: 'Sales', city: 'Riyadh',
          remoteOk: false, skills: ['Negotiation', 'CRM', 'Off-plan'], requirements: [],
        };
        const strong = fit({
          headline: 'Property consultant', currentTitle: 'Property Consultant',
          currentCompany: 'Aqar', locationCity: 'Riyadh', family: 'Sales',
          yearsExperience: 7, skills: ['Negotiation', 'CRM', 'Off-plan'], languages: ['Arabic'],
        }, job);
        const weak = fit({
          headline: 'Baker', currentTitle: 'Baker', currentCompany: 'A bakery',
          locationCity: 'Dammam', family: 'Operations',
          yearsExperience: 1, skills: [], languages: [],
        }, job);

        ok(strong.score > weak.score, `${strong.score} beats ${weak.score}`);
        equals(strong.missing.length, 0, 'the strong one is missing nothing');
        equals(weak.matched.length, 0, 'and the weak one matched nothing');
        ok(strong.parts.length >= 3, 'the score is broken down');
        for (const p of strong.parts) {
          ok(p.pts <= p.max, `${p.key}: ${p.pts} of ${p.max} is within its maximum`);
          ok(p.detail, `${p.key} says why`);
        }
        equals(strong.model, 'local', 'and it was arithmetic, not a model');
      },
    },
    {
      name: 'a fit score is banded, and the bands are ordered',
      fn() {
        equals(fitBandOf(95), 'strong');
        equals(fitBandOf(10), 'weak');
        const order = ['weak', 'fair', 'strong'];
        let last = -1;
        for (let n = 0; n <= 100; n += 5) {
          const i = order.indexOf(fitBandOf(n));
          ok(i >= last, `the band never goes backwards as the score rises (${n})`);
          last = i;
        }
        ok(fitLabelOf(95).length > 0, 'and the band has a word for it');
      },
    },

    /* ── Which industry somebody came from ──────────────────────────────── */
    {
      name: 'a known employer answers the sector outright',
      fn() {
        const table = { 'Real estate & property': ['Aqar Real Estate KSA', 'Property Finder'] };
        equals(sectorOfCompany('Property Finder', table), 'Real estate & property');
        equals(sectorOfCompany('property finder', table), 'Real estate & property', 'whatever the case');
        equals(sectorOfCompany('Aqar', table), 'Real estate & property', 'and however it is shortened');
        equals(sectorOfCompany('A B', table), null, 'but a fragment too short to mean anything does not');
        equals(sectorOfCompany('', table), null);
      },
    },
    {
      name: 'failing that, the words on the page answer it — and say what they read',
      fn() {
        const r = readSector({
          currentCompany: 'Somebody Nobody Has Heard Of',
          currentTitle: 'Property Consultant',
          summary: 'Ten years selling off-plan units in Riyadh.',
        });
        equals(r.sector, 'Real estate & property');
        equals(r.source, 'cv');
        ok(r.why.includes('real estate'), 'and it says what it read');

        const nothing = readSector({ currentCompany: 'X Y Z', currentTitle: 'Person' });
        equals(nothing.sector, 'Other');
        ok(nothing.why.includes('nothing'), 'an unreadable CV says so rather than guessing');
      },
    },
    {
      name: 'every sector rule is reachable and none of them shadows another entirely',
      fn() {
        const seen = new Set<string>();
        for (const [sector, re] of SECTOR_KEYS) {
          /* A rule that cannot fire on its own name is a rule nobody wrote
             on purpose. */
          const probe = sector.toLowerCase().split(/[&,]/)[0].trim();
          const r = readSector({ currentTitle: probe });
          seen.add(r.sector);
          ok(re instanceof RegExp, `${sector} has a rule`);
        }
        ok(seen.size >= 10, `${seen.size} sectors are reachable from their own name`);
      },
    },

    /* ── Probation ──────────────────────────────────────────────────────── */
    {
      name: 'three months from the end of a long month lands inside the short one',
      fn() {
        equals(PROBATION_MONTHS, 3);
        equals(addMonths('2026-01-31', 1), '2026-02-28', 'the 31st of January plus a month is the end of February');
        equals(addMonths('2026-03-15', 3), '2026-06-15');
        equals(addMonths('2025-11-30', 3), '2026-02-28', 'and it crosses a year');
      },
    },
    {
      name: 'probation is in progress, then due, then decided',
      fn() {
        const now = new Date('2026-06-01T00:00:00Z');
        const running = { state: 'in_progress', startsOn: '2026-04-01', endsOn: '2026-07-01' } as Parameters<typeof probationState>[0];
        const due = { state: 'in_progress', startsOn: '2026-01-01', endsOn: '2026-04-01' } as Parameters<typeof probationState>[0];
        const passed = { state: 'passed', startsOn: '2026-01-01', endsOn: '2026-04-01' } as Parameters<typeof probationState>[0];

        equals(probationState(running, now), 'in_progress');
        equals(probationState(due, now), 'due', 'past the end date and undecided is due');
        equals(probationState(passed, now), 'passed');
        ok(!isDecided(running) && isDecided(passed), 'decided means decided');
        equals(daysLeft(running, now), 30, 'thirty days to go');
        ok(daysLeft(due, now) < 0, 'and a negative number is how late it is');
      },
    },

    /* ── The recruiter's tag ────────────────────────────────────────────── */
    {
      name: 'a tag lapses on its own, on the day it was set for',
      fn() {
        const at = new Date('2026-06-01T09:00:00Z');
        equals(claimEndsAt(at, 7).toISOString().slice(0, 10), '2026-06-08');
        equals(claimEndsAt(at, null).toISOString().slice(0, 10),
          new Date(at.getTime() + CLAIM_DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10),
          'and with no length it runs the default');

        ok(claimIsLive(at, 7, new Date('2026-06-05T00:00:00Z')), 'live in the middle');
        ok(!claimIsLive(at, 7, new Date('2026-06-09T00:00:00Z')), 'lapsed after the end');
        ok(!claimIsLive(null, 7, at), 'and a tag nobody placed is not live');
        equals(claimDaysLeft(at, 7, new Date('2026-06-05T09:00:00Z')), 3);
      },
    },
    {
      name: 'a tag length the product does not offer falls back to the default',
      fn() {
        equals(readClaimDays('7'), 7);
        equals(readClaimDays('90'), 90);
        equals(readClaimDays('5000'), CLAIM_DEFAULT_DAYS, 'a year is not on the menu');
        equals(readClaimDays('nonsense'), CLAIM_DEFAULT_DAYS);
        equals(readClaimDays(undefined), CLAIM_DEFAULT_DAYS);
      },
    },

    /* ── How an interview was run ───────────────────────────────────────── */
    {
      name: 'the interviewer review is six criteria meaned onto a hundred',
      fn() {
        equals(CRIT.length, 6);
        equals(CRIT_KEYS.length, 6);
        const perfect = Object.fromEntries(CRIT_KEYS.map((k) => [k, 5]));
        const poor = Object.fromEntries(CRIT_KEYS.map((k) => [k, 1]));
        equals(scoreFrom(perfect), 100);
        equals(scoreFrom(poor), 20);
        equals(scoreFrom({}), 0, 'nothing rated is nought');

        equals(band(90), 'ok');
        equals(band(40), 'bad');
        equals(band(null), '');
        equals(bandText(null), 'Not analysed');
        ok(bandText(90).length > 0, 'and every score has words for it');
      },
    },
    {
      name: 'a review is flagged on compliance, or on a flag somebody raised',
      fn() {
        const fine = { ratings: Object.fromEntries(CRIT_KEYS.map((k) => [k, 4])), flags: [] };
        const lax = { ratings: { ...fine.ratings, compliance: 2 }, flags: [] };
        const raised = { ratings: fine.ratings, flags: ['asked about family plans'] };
        ok(!isFlagged(fine), 'a clean review is not flagged');
        ok(isFlagged(lax), 'compliance at two is');
        ok(isFlagged(raised), 'and so is a raised flag');
        ok(!isFlagged(null), 'and nothing is not a review');
      },
    },
  ],
};

export default suite;
