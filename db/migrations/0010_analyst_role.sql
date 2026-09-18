-- The sixth role on the desk.
--
-- Settings and the Add-a-recruiter form both offer Analyst — somebody who
-- writes scorecards and reads the numbers without owning requisitions — but the
-- enum behind `staff.role` was built from the roles the dataset happened to
-- contain, and nobody in it is an analyst. So the form offered a role the
-- database would refuse, which is the kind of thing that is only ever found by
-- somebody trying to hire one.
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'analyst';
