#!/usr/bin/env python3
"""Download pinned, hash-verified inference assets. No account or paid API."""
import concurrent.futures
import hashlib
import pathlib
import shutil
import sys
import time
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / '.runtime/models'
# (repository, revision, [(file, size, sha256 or None)]), pinned like packages/core/src/model.ts.
models = [
    ('Xenova/multilingual-e5-small', '761b726dd34fb83930e26aab4e9ac3899aa1fa78', [
        ('onnx/model_quantized.onnx', 118308185, 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'),
        ('config.json', 658, None),
        ('tokenizer.json', 17082730, '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'),
        ('tokenizer_config.json', 443, None),
        ('special_tokens_map.json', 167, None),
        ('sentencepiece.bpe.model', 5069051, 'cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865'),
    ]),
    ('onnx-community/siglip2-base-patch16-224-ONNX', 'ba1f3b0843f24bc5417d38e19c37b287d719b2f4', [
        ('config.json', 435, None),
        ('preprocessor_config.json', 394, None),
        ('tokenizer_config.json', 47240, None),
        ('tokenizer.json', 34363039, 'cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322'),
        ('tokenizer.model', 4241003, '61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2'),
        ('onnx/text_model_quantized.onnx', 283438275, '3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400'),
        ('onnx/vision_model_quantized.onnx', 94553333, '5f2b401c1a4fc095702a5d45348e17ad46c4f87064085365b43c6e8eaa5c0070'),
    ]),
]
def valid(path, size, digest):
    if not path.exists() or path.stat().st_size != size:
        return False
    if digest:
        with path.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest() == digest
    return True

def download(spec):
    repo, revision, name, size, digest = spec
    path = target / repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if valid(path, size, digest):
        print('Verified', name, flush=True)
        return
    partial = path.with_suffix(path.suffix + '.part')
    for attempt in range(40):
        if valid(partial, size, digest):
            partial.replace(path)
            print('Prepared', name, flush=True)
            return
        offset = partial.stat().st_size if partial.exists() else 0
        if offset >= size:
            partial.unlink()
            offset = 0
        try:
            request = urllib.request.Request(f'https://huggingface.co/{repo}/resolve/{revision}/{name}?download=true&nonce={time.time_ns()}')
            if offset:
                request.add_header('Range', f'bytes={offset}-')
            with urllib.request.urlopen(request, timeout=30) as response:
                append = offset > 0 and response.status == 206
                with partial.open('ab' if append else 'wb') as stream:
                    shutil.copyfileobj(response, stream, 1024 * 1024)
        except Exception as error:
            print('Retry', name, type(error).__name__, flush=True)
            time.sleep(min(attempt + 1, 4))
    raise RuntimeError(f'Could not verify {name}')

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    list(executor.map(download, [(repo, revision, *file) for repo, revision, files in models for file in files]))
print('Pinned models prepared.', flush=True)
