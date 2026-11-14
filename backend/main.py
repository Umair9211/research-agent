from research_graph import graph

from pydantic import BaseModel

from uuid import uuid4

import json

from fastapi.responses import JSONResponse, StreamingResponse

from fastapi.encoders import jsonable_encoder

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ResearchRequest(BaseModel):
    topic: str
    max_analysts: int = 3

class FeedbackRequest(BaseModel):
    action: str
    feedback: str = ""

def stream_graph(input_state, config):

    def event_generator():

        # Send session ID first
        event = {
            "type": "session",
            "thread_id": config["configurable"]["thread_id"]
        }

        yield f"data: {json.dumps(event)}\n\n"
        try:

            for chunk in graph.stream(
                input_state,
                config=config,
                stream_mode="tasks",
                subgraphs=True,
                version="v2"
            ):

                if chunk["type"] != "tasks":
                    continue

                data = chunk["data"]

                # Node started
                if "input" in data:

                    event = {
                        "type": "node",
                        "node": data["name"],
                        "status": "running",
                        "namespace": chunk["ns"]
                    }

                # Node completed or failed
                else:

                    event = {
                        "type": "node",
                        "node": data["name"],
                        "status": (
                            "error" if data.get("error")
                            else "completed"
                        ),
                        "namespace": chunk["ns"]
                    }

                yield f"data: {json.dumps(event, default=str)}\n\n"

            # Graph execution finished or paused
            snapshot = graph.get_state(config)

            if "human_feedback" in snapshot.next:

                event = {
                    "type": "approval_required",
                    "status": "waiting_for_approval",
                    "analysts": jsonable_encoder(
                        snapshot.values.get("analysts", [])
                    )
                }

            elif snapshot.values.get("final_report"):

                event = {
                    "type": "graph_status",
                    "status": "completed"
                }

            else:

                event = {
                    "type": "graph_status",
                    "status": "finished"
                }

            yield f"data: {json.dumps(event)}\n\n"

        except Exception as e:

            event = {
                "type": "error",
                "message": str(e)
            }

            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )




@app.post("/research")
def start_research(request: ResearchRequest):

    thread_id = str(uuid4())

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    return stream_graph(
        {
            "topic": request.topic,
            "max_analysts": request.max_analysts
        },
        config
)


@app.post("/research/{thread_id}/feedback")
def submit_feedback(thread_id: str, request: FeedbackRequest):

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    # Check whether graph is waiting for feedback
    snapshot = graph.get_state(config)

    if "human_feedback" not in snapshot.next:
        raise HTTPException(
            status_code=400,
            detail="Research is not waiting for analyst feedback."
        )

    if request.action == "revise":

        if not request.feedback.strip():
            raise HTTPException(
                status_code=400,
                detail="Please provide feedback."
            )

        graph.update_state(
            config,
            {
                "human_analyst_feedback": request.feedback
            },
            as_node="human_feedback"
        )

    elif request.action == "approve":

        graph.update_state(
            config,
            {
                "human_analyst_feedback": ""
            },
            as_node="human_feedback"
        )

    else:
        raise HTTPException(
            status_code=400,
            detail="Action must be approve or revise."
        )

    return stream_graph(None, config)

@app.get("/research/{thread_id}/status")
def research_status(thread_id: str):

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    snapshot = graph.get_state(config)

    if not snapshot.values:
        raise HTTPException(
            status_code=404,
            detail="Research session not found."
        )

    next_nodes = list(snapshot.next)

    # Determine the current status
    if "human_feedback" in next_nodes:
        status = "waiting_for_approval"

    elif not next_nodes:
        if snapshot.values.get("final_report"):
            status = "completed"
        else:
            status = "finished"

    else:
        status = "in_progress"

    return {
        "thread_id": thread_id,
        "status": status,
        "next_nodes": next_nodes
    }


@app.get("/research/{thread_id}/report")
def get_report(thread_id: str):

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    snapshot = graph.get_state(config)

    if not snapshot.values:
        raise HTTPException(
            status_code=404,
            detail="Research session not found."
        )

    report = snapshot.values.get("final_report")

    if not report:
        return JSONResponse(
            status_code=202,
            content={
                "thread_id": thread_id,
                "status": "not_ready",
                "message": "The research report is not ready yet."
            }
        )

    return {
        "thread_id": thread_id,
        "status": "completed",
        "report": report
    }

@app.get("/research/graph")
def get_graph_structure():

    return {
        "nodes": [
            {"id": "create_analyst", "label": "Generate Analysts"},
            {"id": "human_feedback", "label": "Human Approval"},
            {"id": "conduct_interview", "label": "Conduct Interviews"},
            {"id": "write_report", "label": "Write Report"},
            {"id": "write_introduction", "label": "Write Introduction"},
            {"id": "write_conclusion", "label": "Write Conclusion"},
            {"id": "finalize_report", "label": "Finalize Report"}
        ],
        "edges": [
            {"source": "create_analyst", "target": "human_feedback"},
            {"source": "human_feedback", "target": "create_analyst"},
            {"source": "human_feedback", "target": "conduct_interview"},
            {"source": "conduct_interview", "target": "write_report"},
            {"source": "conduct_interview", "target": "write_introduction"},
            {"source": "conduct_interview", "target": "write_conclusion"},
            {"source": "write_report", "target": "finalize_report"},
            {"source": "write_introduction", "target": "finalize_report"},
            {"source": "write_conclusion", "target": "finalize_report"},
            {"source": "finalize_report", "target": "END"}
        ]
    }


