import io
import tempfile
import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from faster_whisper import WhisperModel

app = FastAPI()

model = WhisperModel("medium", device="cpu", compute_type="int8")

_INITIAL_PROMPT = (
    "Transcrição de áudio em português brasileiro. "
    "Contexto: conversa informal sobre vendas, planos, mensalidades, clientes e serviços."
)


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio")

    suffix = os.path.splitext(file.filename or "audio.ogg")[1] or ".ogg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        segments, _ = model.transcribe(
            tmp_path,
            language="pt",
            beam_size=7,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            initial_prompt=_INITIAL_PROMPT,
            condition_on_previous_text=True,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
    finally:
        os.unlink(tmp_path)

    return {"text": text}


@app.get("/health")
def health():
    return {"status": "ok"}
