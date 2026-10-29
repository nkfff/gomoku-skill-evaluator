-- V3.2 multi-step puzzles: store the verified full solution sequence.
ALTER TABLE mode_challenges ADD COLUMN solution_sequence TEXT NOT NULL DEFAULT '[]';
