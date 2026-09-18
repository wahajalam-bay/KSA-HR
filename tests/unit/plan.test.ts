import { readPlanGrid, IMPORT_COLUMNS } from '@/lib/services/manpower';
import { csvRows } from '@/lib/domain/sheet';
import { ok, eq as equals, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Reading the spreadsheet a department head keeps.

   This is the one place in the product where a file somebody else maintains
   becomes records, so the reader is deliberately suspicious: it says which
   columns it did not understand, which rows it left out and why, and which
   reporting lines point at a seat the file does not contain. None of that is
   cosmetic — every one of them is a way a plan can be quietly wrong, and the
   preview exists so that a person sees them before anything is written.
   ───────────────────────────────────────────────────────────────────────────*/

const read = (csv: string) => readPlanGrid(csvRows(csv));

const PLAN = `Position title,Reports to,Holder,Grade,Approved headcount,Location,Hiring manager,Start date,Department,Function
Head of Compliance,,Sami Al-Rashid,D1,1,Riyadh,,2024-03-01,Compliance,Finance & Legal
Senior Compliance Officer,Head of Compliance,Huda Al-Saleh,M2,1,Riyadh,,2025-01-15,Compliance,Finance & Legal
Regulatory Affairs Manager,Head of Compliance,,M2,1,Riyadh,Sami Al-Rashid,,Compliance,Finance & Legal
Compliance Analyst,Senior Compliance Officer,,P2,1,Riyadh,Huda Al-Saleh,,Compliance,Finance & Legal
`;

const suite: Suite = {
  name: 'unit · the manpower plan, as a spreadsheet',
  tests: [
    {
      name: 'the worked example in the template reads back as itself',
      fn() {
        const plan = read(PLAN);
        equals(plan.departments.length, 1);
        equals(plan.departments[0].name, 'Compliance');
        equals(plan.departments[0].functionName, 'Finance & Legal');
        equals(plan.departments[0].rows.length, 4);
        equals(plan.rows, 4);
        equals(plan.dropped.length, 0);
        equals(plan.unknownColumns.length, 0);

        const head = plan.departments[0].rows[0];
        equals(head.title, 'Head of Compliance');
        equals(head.reportsTo, null);
        equals(head.holder, 'Sami Al-Rashid');
        equals(head.grade, 'D1');
        equals(head.approved, 1);
        equals(head.startDate, '2024-03-01');
      },
    },

    {
      name: 'the columns are matched however somebody has written them',
      fn() {
        const plan = read(
          'Title,Line Manager,Employee,Band,Headcount,City\n'
          + 'Head of Data,,Noura,D1,1,Riyadh\n'
          + 'Data Analyst,Head of Data,,P3,2,Jeddah\n',
        );
        equals(plan.departments[0].rows.length, 2);
        equals(plan.departments[0].rows[1].reportsTo, 'Head of Data');
        equals(plan.departments[0].rows[1].approved, 2);
        equals(plan.departments[0].rows[1].location, 'Jeddah');
      },
    },

    {
      name: 'a column nobody recognises is reported rather than ignored',
      fn() {
        const plan = read(
          'Position title,Cost centre,Notes\n'
          + 'Head of Data,CC-1200,joined from Aqar\n',
        );
        equals(plan.unknownColumns.join(', '), 'Cost centre, Notes');
      },
    },

    {
      name: 'a sheet with no title column is refused, and says what it does have',
      fn() {
        let message = '';
        try { read('Employee,Band\nNoura,D1\n'); }
        catch (e) { message = e instanceof Error ? e.message : String(e); }
        includes(message, 'Position title');
        includes(message, 'Employee, Band');
      },
    },

    {
      name: 'the header is found under a title row somebody typed above it',
      fn() {
        const plan = read(
          'Compliance department plan 2026\n'
          + 'Position title,Reports to,Grade\n'
          + 'Head of Compliance,,D1\n',
        );
        equals(plan.departments[0].rows.length, 1);
        equals(plan.departments[0].rows[0].title, 'Head of Compliance');
      },
    },

    {
      name: 'several departments in one file are several decisions',
      fn() {
        const plan = read(
          'Position title,Department,Function\n'
          + 'Head of Compliance,Compliance,Finance & Legal\n'
          + 'Head of Data,Data,Technology\n'
          + 'Data Analyst,Data,Technology\n',
        );
        equals(plan.departments.length, 2);
        equals(plan.departments[0].name, 'Compliance');
        equals(plan.departments[0].rows.length, 1);
        equals(plan.departments[1].name, 'Data');
        equals(plan.departments[1].rows.length, 2);
        equals(plan.departments[1].functionName, 'Technology');
      },
    },

    {
      name: 'a reporting line pointing at a seat the file does not have is named',
      fn() {
        const plan = read(
          'Position title,Reports to\n'
          + 'Head of Compliance,\n'
          + 'Compliance Analyst,Chief Risk Officer\n',
        );
        equals(plan.departments[0].orphans.join(', '), 'Chief Risk Officer');
      },
    },

    {
      name: 'a line that points at a seat by its code resolves, and is not an orphan',
      fn() {
        const plan = read(
          'Position title,Position code,Reports to\n'
          + 'Head of Compliance,CMP-001,\n'
          + 'Compliance Analyst,CMP-002,CMP-001\n',
        );
        equals(plan.departments[0].orphans.length, 0);
      },
    },

    {
      name: 'a row with no title is left out, with its row number',
      fn() {
        const plan = read(
          'Position title,Grade\n'
          + 'Head of Compliance,D1\n'
          + ',P3\n'
          + 'Compliance Analyst,P2\n',
        );
        equals(plan.departments[0].rows.length, 2);
        equals(plan.dropped.length, 1);
        equals(plan.dropped[0].row, 3);
        includes(plan.dropped[0].why, 'no position title');
      },
    },

    {
      name: 'a headcount that is not a number is refused rather than rounded to nothing',
      fn() {
        const plan = read(
          'Position title,Approved headcount\n'
          + 'Head of Compliance,1\n'
          + 'Compliance Analyst,two\n',
        );
        equals(plan.departments[0].rows.length, 1);
        includes(plan.dropped[0].why, '"two" is not a headcount');
      },
    },

    {
      name: 'the three ways a date is written here are all read, and a fourth is refused',
      fn() {
        const plan = read(
          'Position title,Start date\n'
          + 'A,2025-09-01\n'
          + 'B,01/09/2025\n'
          + 'C,1 Sep 2025\n'
          + 'D,next Tuesday\n',
        );
        equals(plan.departments[0].rows.length, 3);
        equals(plan.departments[0].rows[0].startDate, '2025-09-01');
        equals(plan.departments[0].rows[1].startDate, '2025-09-01');
        equals(plan.departments[0].rows[2].startDate, '2025-09-01');
        includes(plan.dropped[0].why, 'not a date');
      },
    },

    {
      name: 'a file with a header and nothing under it is refused in words',
      fn() {
        let message = '';
        try { read('Position title,Grade\n'); }
        catch (e) { message = e instanceof Error ? e.message : String(e); }
        includes(message, 'no seats');
      },
    },

    {
      name: 'every column the template documents is a column the reader accepts',
      fn() {
        /* The template, the preview and the reader are meant to be the same
           contract. A column documented in IMPORT_COLUMNS that the reader
           quietly ignores would show up here rather than in somebody's plan. */
        const header = IMPORT_COLUMNS.map((c) => c.key).join(',');
        const plan = read(`${header}\nHead of Compliance,,Sami,D1,2,Riyadh,CMP-001,Noura,2025-01-01,Compliance,Finance\n`);
        equals(plan.unknownColumns.length, 0);
        const row = plan.departments[0].rows[0];
        equals(row.code, 'CMP-001');
        equals(row.approved, 2);
        equals(row.holder, 'Sami');
        equals(row.location, 'Riyadh');
        ok(plan.departments[0].name === 'Compliance', 'and the department came off the row');
      },
    },
  ],
};

export default suite;
