from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import dashboard, reports

app = FastAPI(title="Testease Usage Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reports.router)
app.include_router(dashboard.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
