#!/bin/sh
# Chrome Web Store に出す zip を作る。入れるのは動かすのに要るものだけ（.scout・test・tools・README は入れない）。
# 名前と版は manifest.json から読む。アイコン (icons/icon{16,32,48,128}.png) が揃っていなければ止まる。
# 手元の manifest.json にはアイコンの指定が無い（ファイルが無いと読み込めなくなるため）ので、zip の中の manifest にだけ足す。
set -eu
cd "$(dirname "$0")/.."
miss=""
for n in 16 32 48 128; do
  f="icons/icon$n.png"
  if [ ! -f "$f" ]; then miss="$miss\n  $f が無い（${n}×${n}px の PNG）"; continue; fi
  w=$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/{print $2}'); h=$(sips -g pixelHeight "$f" 2>/dev/null | awk '/pixelHeight/{print $2}')
  fmt=$(sips -g format "$f" 2>/dev/null | awk '/format/{print $2}')
  [ "$w" = "$n" ] && [ "$h" = "$n" ] && [ "$fmt" = "png" ] || miss="$miss\n  $f は ${n}×${n}px の PNG でない（いま ${w:-?}×${h:-?} ${fmt:-?}）"
done
if [ -n "$miss" ]; then
  printf "アイコンが足りないので zip を作りません:%b\n置き場所: %s/icons/\n" "$miss" "$(pwd)" >&2
  exit 1
fi
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/icons"
cp background.js jev.js defaults.js generic.js content.js content.css nico-main.js popup.html popup.js "$STAGE/"
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png "$STAGE/icons/"
OUT=$(python3 - "$STAGE" "${1:-}" <<'PY'
import json, sys, os, re
m = json.load(open('manifest.json'))
icons = {str(n): f'icons/icon{n}.png' for n in (16, 32, 48, 128)}
m['icons'] = icons
m['action']['default_icon'] = {k: icons[k] for k in ('16', '32')}
json.dump(m, open(os.path.join(sys.argv[1], 'manifest.json'), 'w'), ensure_ascii=False, indent=2)
safe = re.sub(r'[^\w.-]+', '-', m['name']).strip('-') or 'extension'
print(sys.argv[2] or os.path.expanduser(f"~/Downloads/{safe}-{m['version']}.zip"))
PY
)
rm -f "$OUT"
(cd "$STAGE" && zip -X -q -r "$OUT" .)
unzip -l "$OUT"
echo "$OUT"
