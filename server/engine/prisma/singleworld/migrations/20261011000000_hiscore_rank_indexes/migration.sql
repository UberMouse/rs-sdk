CREATE INDEX "hiscore_rank" ON "hiscore"("profile", "type", "level" DESC, "playtime", "account_id");
CREATE INDEX "hiscore_large_rank" ON "hiscore_large"("profile", "type", "level" DESC, "playtime", "account_id");
