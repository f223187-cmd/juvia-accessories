from fastapi import APIRouter, Depends
from .core import current

router=APIRouter()

@router.get('/api/vto/status')
def vto_status(user=Depends(current)):
    return {'mode':'on-device','engine':'MediaPipe Tasks Vision (browser)','captures_stored_on_server':False}
