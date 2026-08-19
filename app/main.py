from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import customers, dashboard, events

app = FastAPI(title="Testease Usage Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router)
app.include_router(dashboard.router)
app.include_router(customers.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
