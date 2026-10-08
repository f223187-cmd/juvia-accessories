from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from .core import *

router=APIRouter()

@router.post('/api/vto/landmarks')
async def landmarks(file:UploadFile=File(...),target:str=Query('hand'),u=Depends(current)):
    if target not in {'hand','wrist','finger','neck'}:
        raise HTTPException(422,'Target must be hand, wrist, finger, or neck')
    raw=await file.read()
    if len(raw)>8*1024*1024:
        raise HTTPException(413,'Image exceeds 8 MB')
    try:
        import cv2, mediapipe as mp, numpy as np
        image=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
        if image is None: raise HTTPException(400,'Invalid image')
        rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB)
        with mp.solutions.hands.Hands(static_image_mode=True,max_num_hands=2) as hands:
            hand_result=hands.process(rgb)
        with mp.solutions.face_mesh.FaceMesh(static_image_mode=True,max_num_faces=1) as face_mesh:
            face_result=face_mesh.process(rgb)
        hands_found=hand_result.multi_hand_landmarks or []
        face=(face_result.multi_face_landmarks or [None])[0]
        points=[]; neck=[]; detected=False; ready=False
        guidance='Place your hand inside the guide.'
        if target in {'hand','wrist','finger'}:
            if hands_found:
                points=[{'x':p.x,'y':p.y,'z':p.z} for p in hands_found[0].landmark]
                xs=[p['x'] for p in points]; ys=[p['y'] for p in points]
                width=max(xs)-min(xs); height=max(ys)-min(ys); cx=(max(xs)+min(xs))/2; cy=(max(ys)+min(ys))/2
                detected=True
                if not .16<=cx<=.84 or not .12<=cy<=.9:
                    guidance='Center your hand inside the guide.'
                elif max(width,height)<(.26 if target=='finger' else .20):
                    guidance='Move a little closer to the camera.'
                elif max(width,height)>.88:
                    guidance='Move your hand slightly farther away.'
                else:
                    ready=True
                    guidance={'hand':'Hand detected. Hold still.','wrist':'Wrist detected. Hold still.','finger':'Finger landmarks detected. Hold still.'}[target]
        else:
            guidance='Place your face and neck inside the guide.'
            if face:
                face_points=[{'x':p.x,'y':p.y,'z':p.z} for p in face.landmark]
                xs=[p['x'] for p in face_points]; ys=[p['y'] for p in face_points]
                width=max(xs)-min(xs); cx=(max(xs)+min(xs))/2; cy=(max(ys)+min(ys))/2
                detected=True
                lm=face.landmark
                for i in (152,234,454):
                    p=lm[i]; neck.append({'x':p.x,'y':min(1,p.y+.14),'z':p.z})
                if not .18<=cx<=.82 or not .12<=cy<=.82:
                    guidance='Center your face and neck inside the guide.'
                elif width<.24:
                    guidance='Move a little closer to the camera.'
                elif width>.85:
                    guidance='Move slightly farther from the camera.'
                else:
                    ready=True; guidance='Neck detected. Hold still.'
        log(u,'vto',f'{target}: detected={detected}, ready={ready}')
        return {'target':target,'detected':detected,'ready':ready,'guidance':guidance,
                'hand_landmarks':points,'neck_estimates':neck,
                'message':'Neck fit points are approximate. Review the captured images before accessory placement.'}
    except ImportError:
        raise HTTPException(503,'VTO dependencies unavailable; install the MediaPipe stack')
