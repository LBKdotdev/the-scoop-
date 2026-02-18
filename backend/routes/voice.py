from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
import os
import requests
import json
from database import get_db
from models import Flavor

router = APIRouter(prefix="/api/voice", tags=["voice"])

# Groq API Configuration
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


class VoiceParseRequest(BaseModel):
    transcript: str
    available_flavors: List[str]


class ParsedEntry(BaseModel):
    flavor: str
    type: str
    quantity: float
    action: str  # "add" or "set"
    confidence: float


class VoiceParseResponse(BaseModel):
    entries: List[ParsedEntry]
    confidence: float
    raw_response: str


@router.post("/parse-groq", response_model=VoiceParseResponse)
def parse_voice_with_groq(request: VoiceParseRequest, db: Session = Depends(get_db)):
    """Use Groq AI to parse complex conversational voice input."""

    # Build prompt
    flavors_list = ", ".join(request.available_flavors)

    prompt = f"""You are a voice command parser for an ice cream inventory system.

Available flavors: {flavors_list}

Product types: tub, pint, quart

User said: "{request.transcript}"

Parse this into structured inventory entries. Detect:
1. Flavor names (match to available flavors, use fuzzy matching)
2. Product type (tub/pint/quart)
3. Quantity (numbers, including "a" = 1, "two" = 2, etc.)
4. Action: "add" if they say "another", "found", "add", "plus"; otherwise "set"

Handle:
- Multiple items in one utterance
- Conversational fillers (oh, um, wait)
- Compound entries like "tub of vanilla and chocolate" = 2 entries

Respond ONLY with valid JSON in this exact format:
{{
  "entries": [
    {{"flavor": "Vanilla", "type": "tub", "quantity": 1, "action": "set", "confidence": 0.95}},
    {{"flavor": "Chocolate", "type": "tub", "quantity": 1, "action": "set", "confidence": 0.95}}
  ]
}}

If you can't parse it, return: {{"entries": []}}"""

    try:
        # Call Groq API
        response = requests.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a JSON-only response bot. Always respond with valid JSON only, no other text."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 1024
            },
            timeout=10
        )

        # Check for errors before raising
        if response.status_code != 200:
            error_detail = response.text
            print(f"Groq API Error {response.status_code}: {error_detail}")
            return VoiceParseResponse(
                entries=[],
                confidence=0.0,
                raw_response=f"Groq API Error {response.status_code}: {error_detail}"
            )

        result = response.json()

        # Extract AI response
        ai_response = result["choices"][0]["message"]["content"].strip()

        # Parse JSON from response
        # Handle markdown code blocks if present
        if "```json" in ai_response:
            ai_response = ai_response.split("```json")[1].split("```")[0].strip()
        elif "```" in ai_response:
            ai_response = ai_response.split("```")[1].split("```")[0].strip()

        parsed = json.loads(ai_response)

        # Validate and normalize entries
        validated_entries = []
        for entry in parsed.get("entries", []):
            # Fuzzy match flavor name
            matched_flavor = fuzzy_match_flavor(entry["flavor"], request.available_flavors)
            if matched_flavor:
                validated_entries.append(ParsedEntry(
                    flavor=matched_flavor,
                    type=entry["type"].lower(),
                    quantity=float(entry["quantity"]),
                    action=entry.get("action", "set"),
                    confidence=entry.get("confidence", 0.8)
                ))

        # Calculate overall confidence
        if validated_entries:
            avg_confidence = sum(e.confidence for e in validated_entries) / len(validated_entries)
        else:
            avg_confidence = 0.0

        return VoiceParseResponse(
            entries=validated_entries,
            confidence=avg_confidence,
            raw_response=ai_response
        )

    except Exception as e:
        print(f"Groq API error: {e}")
        return VoiceParseResponse(
            entries=[],
            confidence=0.0,
            raw_response=str(e)
        )


def fuzzy_match_flavor(spoken_name: str, available_flavors: List[str]) -> str:
    """Fuzzy match spoken flavor name to available flavors."""
    spoken = spoken_name.lower().strip()

    # Exact match
    for flavor in available_flavors:
        if flavor.lower() == spoken:
            return flavor

    # Contains match
    for flavor in available_flavors:
        if spoken in flavor.lower() or flavor.lower() in spoken:
            return flavor

    # Word match
    spoken_words = set(spoken.split())
    for flavor in available_flavors:
        flavor_words = set(flavor.lower().split())
        if spoken_words & flavor_words:  # Any word overlap
            return flavor

    return None
