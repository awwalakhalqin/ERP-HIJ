#!/bin/sh
# Container dev memakai dataset uji di volume /data.
#
# Saat volume masih kosong, hij.db disalin sekali dari server/data-test (hasil
# `npm run seed:test` di komputer ini), yang di-mount read-only ke /seed.
# SQLite tidak dibuka langsung dari bind mount Windows: penguncian berkasnya
# tidak bisa diandalkan di sana, sedangkan di volume Docker bisa.
set -e

if [ ! -f /data/hij.db ]; then
  if [ -f /seed/hij.db ]; then
    cp /seed/hij.db /data/hij.db
    echo "  Dataset uji disalin dari server/data-test ke volume Docker."
  else
    echo "  server/data-test/hij.db tidak ada: server mulai dengan basis data kosong."
    echo "  Kata sandi admin pertama dicetak di log di bawah ini."
  fi
fi

exec "$@"
