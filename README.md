# Research Agent

A full-stack AI research assistant that turns a single topic into a multi-agent, human-reviewed research workflow. The backend builds a LangGraph-based research pipeline, while the frontend provides a browser UI to submit research topics, monitor progress, and review/finalize generated reports.

## Overview

This project creates a set of AI analyst personas for a research topic, allows optional human feedback, and then runs a multi-step workflow that:

- generates analyst roles
- asks each analyst to investigate a sub-topic
- performs web and Wikipedia retrieval
- answers questions based on retrieved context
- writes analyst memo sections
- consolidates the findings into a final report
- optionally pauses for human approval before continuing

The application is designed for quickly producing structured research summaries and analyst-style reports from a single user prompt.

## Architecture

### Backend

The backend is a FastAPI service that exposes endpoints for:

- starting a research job
- streaming workflow events
- checking session status
- fetching the final report
- submitting analyst approval or revision feedback

The workflow is implemented in `backend/research_graph.py` using LangGraph and multiple LLM-powered nodes.

### Frontend

The frontend is a React + Vite app that:

- collects a research topic and analyst count
- starts the research workflow
- displays the active workflow graph
- handles human approval steps
- renders the generated final report in the browser

## Project Structure

```text
research-agent/
├── backend/
│   ├── .env.example
│   ├── Dockerfile
│   ├── main.py
│   ├── requirements.txt
│   └── research_graph.py
├── frontend/
│   ├── Dockerfile
│   ├── index.html
│   ├── package.json
│   ├── README.md
│   ├── public/
│   └── src/
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Tech Stack

### Backend

- Python 3.11+
- FastAPI
- LangGraph
- LangChain
- Google Gemini via `langchain_google_genai`
- Tavily search via `langchain_tavily`
- Wikipedia loader
- Pydantic models

### Frontend

- React
- Vite
- @xyflow/react
- dagre

## Environment Variables

Create a `backend/.env` file from the example file:

```bash
cp backend/.env.example backend/.env
```

The example file contains:

```env
GOOGLE_API_KEY=
LANGSMITH_API_KEY=
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=
TAVILY_API_KEY=
```

You must provide valid values for:

- `GOOGLE_API_KEY`: required for the Gemini model used in the research agents
- `TAVILY_API_KEY`: required for web search/retrieval

Optional but useful for observability:

- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT`

## Prerequisites

Before running the project, make sure you have:

- Python 3.11 or newer
- Node.js 22 or newer
- npm
- Docker (optional, for containerized setup)
- API keys for Google Gemini and Tavily

## Local Development Setup

### 1) Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Then start the API:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The backend will be available at:

- http://localhost:8000

### 2) Frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

The frontend will be available at:

- http://localhost:5173

## Docker Setup

The project includes a Docker Compose configuration for running both services together.

```bash
docker compose up --build
```

This starts:

- backend on port 8000
- frontend on port 5173

To stop the containers:

```bash
docker compose down
```

## API Endpoints

### Start research

```http
POST /research
```

Request body:

```json
{
  "topic": "AI in healthcare",
  "max_analysts": 3
}
```

### Submit feedback

```http
POST /research/{thread_id}/feedback
```

Request body:

```json
{
  "action": "approve",
  "feedback": ""
}
```

Valid actions:

- `approve`
- `revise`

### Check session status

```http
GET /research/{thread_id}/status
```

### Get final report

```http
GET /research/{thread_id}/report
```

### Get workflow graph

```http
GET /research/graph
```

## Workflow Logic

The backend graph performs the following phases:

1. `create_analyst`
   - creates multiple AI analyst personas based on the research topic
2. `human_feedback`
   - interrupts the workflow for optional reviewer approval or revision guidance
3. `conduct_interview`
   - each analyst interviews an expert using generated questions
   - searches web and Wikipedia for supporting context
   - produces answers grounded in retrieved source material
4. `write_report`
   - combines analyst outputs into a research memo
5. `write_introduction`
   - generates a summary introduction
6. `write_conclusion`
   - generates a closing summary
7. `finalize_report`
   - merges the sections and returns the final report

## Usage

1. Open the frontend in the browser.
2. Enter the topic you want researched.
3. Adjust the number of analysts if needed.
4. Click "Start research".
5. Monitor the workflow state.
6. If the workflow pauses for human approval, either approve or revise the research direction.
7. When the process finishes, the final report is displayed in the browser.

## Notes

- The app depends on live external services, so internet access and valid API keys are required.
- The frontend assumes the backend runs on `http://localhost:8000` unless `VITE_API_URL` is set.
- The workflow is stateful per research session using a thread ID.
- Some parts of the project are still experimental and may require tuning for specific research domains.

## Troubleshooting

### Backend fails to start

Check that:

- the Python environment is activated
- dependencies are installed from `backend/requirements.txt`
- `backend/.env` contains valid keys

### Frontend cannot reach the API

Check:

- backend is running on port 8000
- `VITE_API_URL` is correctly configured if using a different host
- CORS settings are valid for your frontend origin

### Missing API keys

The application will not run properly without valid credentials for:

- Google Gemini
- Tavily

## License

This project does not currently declare a license file. If you plan to share or deploy it publicly, add an explicit license before distribution.

## Future Improvements

Possible enhancements include:

- richer source citations and reference validation
- persistent storage for research sessions
- user authentication and saved research history
- support for additional search providers
- better multi-agent coordination and streaming UX
