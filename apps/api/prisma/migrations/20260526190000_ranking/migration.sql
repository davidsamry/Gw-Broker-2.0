-- Ranking entries pool. See prisma/schema.prisma RankingEntry model.

CREATE TABLE "ranking_entries" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "amount"      DECIMAL(18,2) NOT NULL,
    "active"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ranking_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ranking_entries_active_idx" ON "ranking_entries"("active");

-- Seed the same 25 entries the frontend's RankingPanel currently has
-- hard-coded, so the UX is identical from day one. Admin can edit/add/
-- remove from /admin/ranking.
INSERT INTO "ranking_entries" ("id", "name", "countryCode", "amount", "active", "updatedAt") VALUES
  ('seed_rank_01', 'Apollo I.',     'br', 91590.80, true, NOW()),
  ('seed_rank_02', 'Yonathan D.',   'id', 39531.14, true, NOW()),
  ('seed_rank_03', 'Joseph R.',     'kr', 39069.49, true, NOW()),
  ('seed_rank_04', 'Felipe A.',     'ng', 38544.89, true, NOW()),
  ('seed_rank_05', 'Mariana X.',    'us', 38456.75, true, NOW()),
  ('seed_rank_06', 'Valci L.',      'pt', 37887.26, true, NOW()),
  ('seed_rank_07', 'Pedro B.',      'kr', 37800.08, true, NOW()),
  ('seed_rank_08', 'Daniel O.',     'id', 37290.47, true, NOW()),
  ('seed_rank_09', 'Isabela G.',    'us', 37049.92, true, NOW()),
  ('seed_rank_10', 'Kanwara S.',    'pe', 36849.53, true, NOW()),
  ('seed_rank_11', 'Diego B.',      'jp', 36703.25, true, NOW()),
  ('seed_rank_12', 'Angelo H.',     'br', 36540.96, true, NOW()),
  ('seed_rank_13', 'Leonardo U.',   'bo', 36417.43, true, NOW()),
  ('seed_rank_14', 'Vinicius A.',   'br', 36351.49, true, NOW()),
  ('seed_rank_15', 'Leo V.',        'de', 36291.68, true, NOW()),
  ('seed_rank_16', 'Julia J.',      'us', 36162.91, true, NOW()),
  ('seed_rank_17', 'Ricardo P.',    'br', 36041.10, true, NOW()),
  ('seed_rank_18', 'Sofia T.',      'ar', 35987.55, true, NOW()),
  ('seed_rank_19', 'Hans M.',       'de', 35804.21, true, NOW()),
  ('seed_rank_20', 'Yuki N.',       'jp', 35692.83, true, NOW()),
  ('seed_rank_21', 'Carlos R.',     'mx', 35501.16, true, NOW()),
  ('seed_rank_22', 'Anna K.',       'ru', 35349.90, true, NOW()),
  ('seed_rank_23', 'Bruno C.',      'pt', 35178.42, true, NOW()),
  ('seed_rank_24', 'Priya S.',      'in', 35044.61, true, NOW()),
  ('seed_rank_25', 'Olivia W.',     'gb', 34902.18, true, NOW());
