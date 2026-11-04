"""Export fixed batch-one float32 model and verify it against PyTorch on CPU."""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
import torch
ROOT=Path(__file__).resolve().parents[1];WEB=ROOT/'web' if (ROOT/'web').exists() else ROOT
from torch_model import PolicyValueNet
def load_model(path,device):
    saved=torch.load(path,map_location=device,weights_only=True);net=PolicyValueNet(saved.get('channels',64),saved.get('blocks',8),saved.get('dropout',0)).to(device);net.load_state_dict(saved['model']);return net.eval(),saved
def encode(board,player,last):
    state=np.zeros((4,15,15),np.float32);state[0]=(board==player).reshape(15,15);state[1]=(board==3-player).reshape(15,15);state[3].fill(player==1)
    if last>=0:state[2].flat[last]=1
    return state


def main():
    import onnx,onnxruntime as ort
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',required=True);p.add_argument('--model-id');p.add_argument('--output',default=str(WEB/'models'));a=p.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    torch.set_num_threads(1);net,meta=load_model(a.checkpoint,'cpu');net.eval().requires_grad_(False);model=out/'gunuce.onnx'
    torch.onnx.export(net,torch.zeros(1,4,15,15),str(model),opset_version=17,input_names=['state'],output_names=['policy','value'],do_constant_folding=True,dynamo=False)
    onnx.checker.check_model(str(model));options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1;session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider'])
    rng=np.random.default_rng(118101);vectors=[];errors=[]
    for stones in [0,1,2,3,6,10,20,40,60,80,120,180]:
        board=np.zeros(225,np.int8);moves=rng.choice(225,stones,replace=False)
        for i,action in enumerate(moves):board[action]=i%2+1
        state=encode(board,stones%2+1,int(moves[-1]) if stones else -1)[None]
        with torch.inference_mode():expected=[x.numpy() for x in net(torch.from_numpy(state))]
        actual=session.run(None,{'state':state});error=[float(np.max(np.abs(x-y))) for x,y in zip(expected,actual)];errors.append(error)
        np.testing.assert_allclose(actual[0],expected[0],rtol=1e-4,atol=2e-4);np.testing.assert_allclose(actual[1],expected[1],rtol=1e-4,atol=2e-5)
        vectors.append({'state':state.flatten().tolist(),'policy':expected[0][0].tolist(),'value':float(expected[1][0])})
    manifest={'version':'4.0.1','format':'gunuce-fp32-batch1','file':'gunuce.onnx','sha256':hashlib.sha256(model.read_bytes()).hexdigest(),'bytes':model.stat().st_size,'sourceCheckpointSha256':hashlib.sha256(Path(a.checkpoint).read_bytes()).hexdigest(),'channels':meta.get('channels',64),'blocks':meta.get('blocks',8),'input':'state','outputs':['policy','value'],'shape':[1,4,15,15],'simulations':128,'modelId':a.model_id or Path(a.checkpoint).stem,'search':{'fpuReduction':.2,'finalTieBreak':['visits','prior','q']},'verification':{'positions':len(errors),'maxPolicyAbsError':max(x[0] for x in errors),'maxValueAbsError':max(x[1] for x in errors)}}
    (out/'model.json').write_text(json.dumps(manifest,indent=2)+'\n');fixtures=WEB/'test/fixtures/onnx-reference.json';fixtures.parent.mkdir(parents=True,exist_ok=True);fixtures.write_text(json.dumps(vectors));print(json.dumps(manifest,indent=2))

if __name__=='__main__':main()
