#!/bin/bash
# Fetches robots.txt and a few public pages per candidate site, politely (one request every 2 s, honest user agent),
# so the sources can be evaluated. Output: survey/<domain>/<page>.{html,status}
UA='DeesidePropertyWatch/0.1 (personal research; one-off survey; github.com/p2n5dwfr56-commits)'
mkdir -p survey
grep -v '^#' tools/survey/sites.txt | while IFS='|' read -r dom pages; do
  dom=$(echo $dom); mkdir -p survey/$dom
  for pg in $pages; do
    f=survey/$dom/$(echo "$pg" | tr '/?=&' '____' | sed 's/^_$/_root/')
    code=$(curl -sS -L -A "$UA" -m 25 -o "$f.body" -w '%{http_code} %{url_effective} %{size_download}' "https://$dom$pg" 2>&1 | tail -1)
    echo "$code" > "$f.status"; head -c 400000 "$f.body" > "$f.txt"; rm -f "$f.body"; sleep 2
  done
done
for s in survey/*/*.status; do echo "$s: $(cat $s)"; done > survey/INDEX.txt
