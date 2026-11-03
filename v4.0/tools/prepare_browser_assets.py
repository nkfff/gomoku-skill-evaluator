"""Vendor pinned ORT and generate a scope-safe offline cache from explicit static files."""
import hashlib,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];WEB=ROOT/'web' if (ROOT/'web').exists() else ROOT;GROUPS=[['ort.webgpu.min.mjs','ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.wasm'],['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']];RUNTIME=[f for group in GROUPS for f in group]

def main():
    package=json.loads((WEB/'node_modules/onnxruntime-web/package.json').read_text());destination=WEB/'vendor/ort';destination.mkdir(parents=True,exist_ok=True)
    if package['version']!='1.31.1':raise ValueError('runtime must match pinned version 1.31.1')
    for name in RUNTIME:shutil.copyfile(WEB/'node_modules/onnxruntime-web/dist'/name,destination/name)
    if not (destination/'LICENSE').exists():raise ValueError('ORT MIT license missing')
    (destination/'README.md').write_text('ONNX Runtime Web '+package['version']+'\nSource: https://github.com/microsoft/onnxruntime\nNPM: onnxruntime-web@'+package['version']+'\nMIT license: see LICENSE.\nVendored unchanged; use tools/prepare_browser_assets.py to update from the locked npm install.\n')
    files=['index.html','config.js','pvp-ui.js','special-modes-ui.js','models/model.json','models/gunuce.onnx']+[str(p.relative_to(WEB)) for p in sorted((WEB/'src').glob('*')) if p.suffix in ('.js','.css')]+['vendor/ort/'+n for n in RUNTIME]
    hashes={name:hashlib.sha256((WEB/name).read_bytes()).hexdigest() for name in files};version=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()[:16]
    shell=['./']+[name for name in files if not name.startswith('vendor/') and not name.endswith('.onnx')]
    source=(ROOT/'tools/offline-sw.template.js').read_text().replace('__VERSION__',version).replace('__ASSETS__',json.dumps(['./']+files)).replace('__SHELL__',json.dumps(shell)).replace('__GROUPS__',json.dumps([['vendor/ort/'+f for f in group] for group in GROUPS]))
    (WEB/'sw.js').write_text(source)
    manifest={'version':'4.0.1','cacheVersion':version,'onnxruntime':package['version'],'files':hashes,'totalAssetBytes':sum((WEB/f).stat().st_size for f in files),'note':'Runtime/model cached lazily on first Gunuce use. No inference endpoint.'};(WEB/'offline-assets.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Prepared static offline assets:',manifest['totalAssetBytes'],'bytes; cache',version)

if __name__=='__main__':main()
