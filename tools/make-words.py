# Списки слов «Скорости печати» по частоте: 5000 самых частых слов шести языков.
#
# Откуда слова:
#   - частоты - wordfreq 3.1.1 (Robyn Speer и др., данные CC BY-SA 4.0:
#     Wikipedia, субтитры OpenSubtitles, книги, новости и др.);
#   - сито - словари Hunspell из wooorm/dictionaries (по одному на язык): слово остаётся,
#     только если словарь знает его в таком написании. Так уходят имена и названия
#     (в словаре они с большой буквы), сокращения, мусор и слова чужого языка;
#   - запрет - грубые и оскорбительные слова (tools/blocklist.b64.txt: выражения в base64,
#     чтобы файл не читался глазами; закон страницы проверяет списки теми же выражениями).
#
# Немецкие существительные пишутся с большой буквы - так их и надо печатать, поэтому для
# немецкого слово, которое словарь знает только с большой буквы, остаётся с большой
# (кроме имён и названий из списка DE_NAMES). wordfreq хранит ß как ss и œ как oe - слово
# возвращается к словарному написанию.
#
# Китайский (zh): упрощённые иероглифы из wordfreq, только слова из иероглифов, без грубых слов
# и имён политиков; словарь Hunspell не нужен. Для каждого слова - пиньинь без тонов (pypinyin):
# блок WORDS_PY, режим «пиньинь латиницей» и подсказка над иероглифами.
#
# Запуск (нужны pip install wordfreq==3.1.1 spylls pypinyin==0.55.0 и папка со словарями <язык>.aff/.dic):
#   python tools/make-words.py <папка словарей>
# Скрипт заменяет в index.html блок между строками «// WORDS:BEGIN» и «// WORDS:END».
import base64
import itertools
import json
import os
import re
import sys

import wordfreq
from spylls.hunspell import Dictionary

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, '..', 'index.html')
LANGS = ['ru', 'uk', 'en', 'de', 'fr', 'es']
TOTAL = 5000

LETTERS = {
    'ru': 'а-яё',
    'uk': "а-щьюяєіїґ'",
    'en': 'a-z',
    'de': 'a-zäöüß',
    'fr': 'a-zàâæçéèêëîïôœùûüÿ',
    'es': 'a-záéíóúüñ',
}
# Слова в одну-две буквы: только настоящие (сокращения вроде «км», «кг», «Mr» не берутся)
SHORT = {
    'ru': set('в и на не с я по а из за о к но то у он от же мы до ты бы их во вы со ее да ну ни об ли им её ей те уж ко та ой ту ох ах ею эй юг'.split()),
    'uk': set('в на не і у з що та до це за а я як то ви по ми й ще із чи ти ну її їх де ні те зі бо от о же ці би ця їм цю ті аж ту ой ох хм ай ах об'.split()),
    'en': set('a i an as at be by do go he if in is it me my no of oh on or so to up us we'.split()),
    'de': set('in zu es im er an so du am um da ja ab wo ob je oh Ei Öl'.split()),
    'fr': set('de la le et à en un a du il je au ce on ne se ça tu y ai ou si sa me où va ma là te as es vu eu ta ci ni pu or ah oh dû lu né nu os'.split()),
    'es': set('de la el en y a no un se es lo su al me si te o mi le ya ha yo tu ni e va he él sí ir da sé ti tú mí os ve vi u ah fe eh ay oh'.split()),
}
# Что словарь пропустил, но в тесте печати не нужно: имена, названия, чужие слова
DROP = {
    'ru': set('кремля кремль ссср тверской германии германия франции франция нью киев'.split()),
    'uk': set('максим ляшко мне київ франції франція'.split()),
    'en': set('ok co st pic eve'.split()),
    'de': set('New City Amazon Müller Angela Sophie Jean Magdeburg Bochum time is the'.split()),
    'fr': set('qu jusqu lorsqu puisqu quoiqu presqu martin benoît mali stop box lol street'.split()),
    'es': set('maría brasil francisco diego marruecos time is'.split()),
}
# Имена и названия из других языков (в их словарях - только с большой буквы) отсеиваются
# за пределами первой тысячи: так уходят «maría», «angela», «максим», а частые слова языка
# вроде «вера» или «rose» остаются, если они в первой тысяче.
NAME_DEPTH = 30000
KEEP_TOP = 1000

# Имена и названия, которые немецкий словарь знает с большой буквы, как и существительные
DE_NAMES = set('''
deutschland österreich schweiz europa amerika afrika asien australien russland frankreich italien
spanien england china japan polen türkei griechenland ukraine indien israel iran irak syrien kanada
brasilien mexiko ägypten niederlande holland belgien dänemark schweden norwegen finnland ungarn
tschechien portugal irland schottland bayern sachsen hessen thüringen brandenburg niedersachsen
westfalen preussen preußen berlin münchen hamburg wien köln frankfurt stuttgart düsseldorf dresden
leipzig bremen hannover nürnberg dortmund essen bonn zürich genf paris london rom moskau peking
washington york madrid athen prag warschau rhein donau elbe alpen berliner wiener münchner kölner
hamburger frankfurter michael thomas peter hans klaus andreas stefan wolfgang jürgen uwe maria anna
martin christian alexander daniel paul markus frank tobias sebastian david jan tim tom max ben lukas
jonas felix julia laura lisa sarah anja petra sabine claudia monika ursula karl heinz werner helmut
günter dieter horst gerhard franz josef georg wilhelm friedrich ludwig otto ernst walter fritz merkel
trump obama putin hitler goethe schiller luther marx bach beethoven mozart einstein jesus christus
maria gott
'''.split()) - {'gott'}


def blocklist():
    rules = {}
    with open(os.path.join(HERE, 'blocklist.b64.txt'), encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            lang, b64 = line.split(' ', 1)
            rules[lang] = re.compile(base64.b64decode(b64).decode('utf-8'))
    return rules


def variants(lang, w):
    """Словарные написания слова из wordfreq: ss -> ß (de), oe -> œ (fr)."""
    yield w
    pairs = {'de': ('ss', 'ß'), 'fr': ('oe', 'œ')}.get(lang)
    if not pairs or pairs[0] not in w:
        return
    parts = w.split(pairs[0])
    for combo in itertools.product((pairs[0], pairs[1]), repeat=len(parts) - 1):
        if all(c == pairs[0] for c in combo):
            continue
        s = parts[0]
        for c, p in zip(combo, parts[1:]):
            s += c + p
        yield s


def build(lang, dic, block, names):
    letters = re.compile('^[' + LETTERS[lang] + ']+$')
    out, seen = [], set()
    rules = [block['*'], block['ru' if lang in ('ru', 'uk') else lang]]
    for raw in wordfreq.iter_wordlist(lang):
        w = raw.replace('’', "'")
        if not letters.match(w) or w.startswith("'") or w.endswith("'"):
            continue
        if len(w) <= 2 and w not in SHORT[lang] and w[:1].upper() + w[1:] not in SHORT[lang]:
            continue
        picked = None
        for v in variants(lang, w):
            if dic.lookup(v):
                picked = v
                break
            if lang == 'de' and v not in DE_NAMES and dic.lookup(v[:1].upper() + v[1:]):
                picked = v[:1].upper() + v[1:]
                break
        if not picked or picked in seen or picked in DROP[lang]:
            continue
        if len(out) >= KEEP_TOP and picked.lower() in names.get(script(lang), set()):
            continue
        if any(r.search(picked.lower()) for r in rules):
            continue
        seen.add(picked)
        out.append(picked)
        if len(out) >= TOTAL:
            break
    return out


def script(lang):
    return 'cyr' if lang in ('ru', 'uk') else 'lat'


def proper_names(dics):
    """Слова, которые словарь языка знает только с большой буквы (имена, названия)."""
    names = {}
    for lang, dic in dics.items():
        if lang == 'de':
            continue  # у немцев с большой буквы все существительные
        bucket = names.setdefault(script(lang), set())
        for w in wordfreq.top_n_list(lang, NAME_DEPTH):
            if w.isalpha() and len(w) > 2 and not dic.lookup(w) and dic.lookup(w[:1].upper() + w[1:]):
                bucket.add(w)
    return names


HAN_WORD = re.compile(r'^[\u4e00-\u9fff]{1,4}$')


def build_zh(block):
    rules = [block['*'], block['zh']]
    out, seen = [], set()
    for w in wordfreq.iter_wordlist('zh'):
        if not HAN_WORD.match(w) or w in seen or any(r.search(w) for r in rules):
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= TOTAL:
            break
    return out


def main():
    dic_dir = sys.argv[1]
    block = blocklist()
    dics = {lang: Dictionary.from_files(os.path.join(dic_dir, lang)) for lang in LANGS}
    names = proper_names(dics)
    data = {}
    for lang in LANGS:
        words = build(lang, dics[lang], block, names)
        if len(words) < TOTAL:
            raise SystemExit(f'{lang}: только {len(words)} слов')
        data[lang] = ' '.join(words)
        print(lang, len(words), ' '.join(words[:40]))
    from pypinyin import lazy_pinyin
    zh = build_zh(block)
    if len(zh) < TOTAL:
        raise SystemExit(f'zh: только {len(zh)} слов')
    data['zh'] = ' '.join(zh)
    zh_py = ' '.join(''.join(lazy_pinyin(w)) for w in zh)
    lines = ['// WORDS:BEGIN - создаётся tools/make-words.py, руками не править.',
             '// Частоты: wordfreq 3.1.1 (CC BY-SA 4.0), сито: словари Hunspell, без грубых слов.',
             '// Этот блок данных - под лицензией CC BY-SA 4.0 (остальной код страницы - MIT).',
             'const WORDS = {']
    for lang in LANGS + ['zh']:
        lines.append(f'  {lang}: {json.dumps(data[lang], ensure_ascii=False)},')
    lines.append('};')
    lines.append('// Пиньинь без тонов к словам WORDS.zh, по порядку (pypinyin 0.55.0, MIT).')
    lines.append(f'const WORDS_PY = {{ zh: {json.dumps(zh_py)} }};')
    lines.append('// WORDS:END')
    with open(PAGE, encoding='utf-8') as f:
        html = f.read()
    start = html.index('// WORDS:BEGIN')
    start = html.rindex('\n', 0, start) + 1
    end = html.index('// WORDS:END')
    end = html.index('\n', end) + 1
    html = html[:start] + '\n'.join(lines) + '\n' + html[end:]
    with open(PAGE, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)


if __name__ == '__main__':
    main()
