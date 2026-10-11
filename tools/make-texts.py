# Тексты режима «текст» «Скорости печати»: tools/texts/<язык>.txt -> блок TEXTS в index.html.
#
# Формат файла: блоки через пустую строку, строки с «#» в начале файла - комментарий;
# строка «@автор, произведение» перед текстом - источник (общественное достояние), без неё -
# свой текст проекта. Текст одного блока может идти в несколько строк - они склеиваются
# через пробел.
#
# Длина текста - число слов (для китайского - число иероглифов): ~10, ~20, ~50, ~100, ~200,
# ~300 (китайский: ~20, ~40, ~100, ~200, ~400, ~600), допуск ±20 %. На каждую длину - ровно
# по 10 текстов, повторов нет. Скрипт проверяет это и падает с объяснением.
#
# Для китайского ещё нужна разбивка на слова и пиньинь без тонов (режим «пиньинь латиницей»
# и подсказка над иероглифами): pip install jieba==0.42.1 pypinyin==0.55.0.
#
#   python tools/make-texts.py            # проверить и записать в index.html
#   python tools/make-texts.py --check    # только проверить
#   --allow-missing                       # черновик: языки без файла пропустить
#   --only=ru,en                          # черновик: только эти языки
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, '..', 'index.html')
LANGS = ['ru', 'uk', 'en', 'de', 'fr', 'es', 'zh']
TARGETS = [10, 20, 50, 100, 200, 300]
ZH_FACTOR = 2
PER_BUCKET = 10
TOL = 0.2

HAN = re.compile(r'[㐀-䶿一-鿿]')
WORD = re.compile(r"[\w'’-]*\w[\w'’-]*", re.UNICODE)


def normalize(lang, t):
    t = ' '.join(t.split())
    if lang == 'zh':
        return t.replace(' ', '')
    # знаки, которых нет на обычной клавиатуре, - на привычные
    for a, b in (('«', '"'), ('»', '"'), ('„', '"'), ('“', '"'), ('”', '"'), ('’', "'"), ('—', '-'), ('–', '-'), ('…', '...'), (' ', ' ')):
        t = t.replace(a, b)
    t = t.replace('" ', '"').replace(' "', ' "') if False else t
    return t


def count(lang, t):
    if lang == 'zh':
        return len(HAN.findall(t))
    return sum(1 for w in t.split() if any(ch.isalnum() for ch in w))


def bucket(lang, n):
    k = ZH_FACTOR if lang == 'zh' else 1
    for target in TARGETS:
        aim = target * k
        if aim * (1 - TOL) <= n <= aim * (1 + TOL):
            return target
    return None


def parse(lang):
    path = os.path.join(HERE, 'texts', lang + '.txt')
    raw = open(path, encoding='utf-8').read().replace('\r\n', '\n')
    out = []
    for block in re.split(r'\n\s*\n', raw):
        lines = [ln.strip() for ln in block.strip().split('\n') if ln.strip() and not ln.startswith('#')]
        if not lines:
            continue
        src = None
        if lines[0].startswith('@'):
            src = lines[0][1:].strip()
            lines = lines[1:]
        if not lines:
            raise SystemExit(f'{lang}: источник без текста: {src}')
        t = normalize(lang, ' '.join(lines))
        out.append({'t': t, 'src': src})
    return out


def check(lang, items):
    errors = []
    buckets = {t: 0 for t in TARGETS}
    seen = set()
    for it in items:
        n = count(lang, it['t'])
        b = bucket(lang, n)
        it['n'] = n
        it['len'] = b
        key = re.sub(r'\W+', '', it['t'].lower())
        if key in seen:
            errors.append(f'повтор: {it["t"][:50]}')
        seen.add(key)
        if b is None:
            errors.append(f'{n} слов - ни в одну длину: {it["t"][:60]}')
        else:
            buckets[b] += 1
    for t, c in buckets.items():
        if c != PER_BUCKET:
            errors.append(f'~{t}: {c} текстов вместо {PER_BUCKET}')
    return errors


def zh_segments(text):
    """[[слово, пиньинь без тонов], ...]; у знаков препинания пиньинь пустой."""
    import jieba
    from pypinyin import lazy_pinyin
    jieba.setLogLevel(60)
    segs = []
    for w in jieba.cut(text):
        if HAN.search(w):
            segs.append([w, ''.join(lazy_pinyin(w))])
        else:
            for ch in w:
                segs.append([ch, ''])
    return segs


def main():
    only_check = '--check' in sys.argv
    only = [a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')]
    langs = only[0] if only else LANGS
    data, bad = {}, False
    for lang in langs:
        if not os.path.exists(os.path.join(HERE, 'texts', lang + '.txt')):
            print(f'{lang}: нет файла')
            bad = bad or '--allow-missing' not in sys.argv   # для черновых прогонов
            continue
        items = parse(lang)
        errors = check(lang, items)
        counts = {t: sum(1 for i in items if i['len'] == t) for t in TARGETS}
        print(f'{lang}: {len(items)} текстов, по длинам {counts}')
        for e in errors:
            print('   ', e)
        bad = bad or bool(errors)
        data[lang] = items
    if bad:
        raise SystemExit('тексты не прошли проверку')
    if only_check:
        return
    lines = ['// TEXTS:BEGIN - создаётся tools/make-texts.py из tools/texts/*.txt, руками не править.',
             '// len - длина в словах (у китайского - в иероглифах /2), src - автор (общественное достояние).',
             'const TEXTS = {']
    for lang in [x for x in LANGS if x in data]:
        rows = []
        for it in sorted(data[lang], key=lambda i: (i['len'], i['n'])):
            row = {'t': it['t'], 'src': it['src'], 'len': it['len']}
            if lang == 'zh':
                row['seg'] = zh_segments(it['t'])
            rows.append('    ' + json.dumps(row, ensure_ascii=False) + ',')
        lines.append(f'  {lang}: [')
        lines.extend(rows)
        lines.append('  ],')
    lines.append('};')
    lines.append('// TEXTS:END')
    html = open(PAGE, encoding='utf-8').read()
    start = html.index('// TEXTS:BEGIN')
    start = html.rindex('\n', 0, start) + 1
    end = html.index('// TEXTS:END')
    end = html.index('\n', end) + 1
    html = html[:start] + '\n'.join(lines) + '\n' + html[end:]
    open(PAGE, 'w', encoding='utf-8', newline='\n').write(html)
    print('index.html: блок TEXTS записан')


if __name__ == '__main__':
    main()
