import urllib.request, os, sys

px = 'http://127.0.0.1:7890'
op = urllib.request.build_opener(urllib.request.ProxyHandler({'http': px, 'https': px}))
op.addheaders = [('User-Agent', 'Mozilla/5.0')]
out = r'D:\singer\work\ref'
os.makedirs(out, exist_ok=True)
base = 'https://raw.githubusercontent.com/nomadkaraoke/python-audio-separator/main/audio_separator/separator/archs/'
for f in ['mdx_separator.py']:
    try:
        d = op.open(base + f, timeout=40).read()
        open(os.path.join(out, f), 'wb').write(d)
        print('OK', f, len(d))
    except Exception as e:
        print('ERR', f, e)
