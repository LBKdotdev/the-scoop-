from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import json
import os
import requests
from database import get_db
from models import Flavor
from routes.voice import fuzzy_match_flavor

router = APIRouter(prefix="/api/photo-import", tags=["photo-import"])

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


class PhotoParseRequest(BaseModel):
    image_base64: str
    available_flavors: List[str]


class EntryResult(BaseModel):
    flavor_sheet_name: str
    flavor_matched_name: Optional[str]
    flavor_id: Optional[int]
    product_type: str
    count: float
    confidence: float


class DateResult(BaseModel):
    date: str
    employee_initials: Optional[str]
    entries: List[EntryResult]


class PhotoParseResponse(BaseModel):
    sheet_type: str
    dates: List[DateResult]
    unmatched_flavors: List[str]
    warnings: List[str]


VISION_PROMPT = """You are analyzing a photograph of a handwritten ice cream inventory count sheet.

AUTO-DETECT the sheet type from headers:
- "Inventory" or similar → Tub Inventory Sheet (tubs)
- "Pints" / "Quarts" / "Pints & Quarts" → Pints & Quarts Sheet (pints_quarts)

RULES FOR TUB INVENTORY SHEETS:
- Layout: Flavors down the left, dates across the top
- Each date column has "Tally" and "Total" sub-columns
- READ ONLY the "Total" column values (ignore tally marks)
- Totals may contain fractions: 3/4 = 0.75, 1/2 = 0.5, 1/4 = 0.25
- Example: "6 3/4" = 6.75, "3 1/2" = 3.5, "10" = 10.0
- product_type is always "tub"

RULES FOR PINTS & QUARTS SHEETS:
- Layout: Flavors down the left, days-of-week across the top
- Each day has "Pint" and "Quart" sub-columns
- Data is TALLY MARKS only (no numeric totals)
- Tally system: 4 vertical lines + 1 diagonal cross = 5
- Count each group of 5 carefully, then add remaining individual marks
- Generate separate entries for pints (product_type "pint") and quarts (product_type "quart")

EXTRACTING DATES:
- Look for dates in column headers (e.g., "2/9", "Feb 9", "2-9-26")
- Convert all dates to ISO format: YYYY-MM-DD (assume year 2026 if not shown)
- For day-of-week headers (Mon, Tue...), infer dates from any date references on the sheet
- Look for employee initials near each date header (e.g., "MG", "AH")

CONFIDENCE SCORING:
- 1.0 = clearly legible, no ambiguity
- 0.7-0.9 = mostly legible, minor uncertainty
- 0.4-0.6 = hard to read, best guess
- 0.1-0.3 = very unclear, low confidence guess

IMPORTANT:
- Skip empty/blank cells entirely (do not include them)
- Flavor names may span MULTIPLE LINES in the left column (e.g., "Banana" on one line and "Marshmallow" on the next = one flavor "Banana Marshmallow"). Combine them into a single flavor name. Do NOT create separate entries for each line of a multi-line flavor name.
- Read flavor names exactly as written on the sheet
- If a cell is crossed out or has corrections, use the final/corrected value

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "sheet_type": "tubs" or "pints_quarts",
  "dates": [
    {
      "date": "2026-02-09",
      "employee_initials": "MG" or null,
      "entries": [
        {
          "flavor_name": "Sweet Cream",
          "product_type": "tub",
          "count": 6.75,
          "confidence": 0.95
        }
      ]
    }
  ],
  "warnings": ["any issues or notes about the scan"]
}"""


def parse_with_groq(image_base64: str) -> str:
    """Parse sheet image using Groq Vision (Llama 4 Scout). Returns raw JSON text."""
    response = requests.post(
        GROQ_API_URL,
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": "meta-llama/llama-4-scout-17b-16e-instruct",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}",
                            },
                        },
                        {
                            "type": "text",
                            "text": VISION_PROMPT,
                        },
                    ],
                }
            ],
            "temperature": 0.1,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        },
        timeout=60,
    )

    if response.status_code != 200:
        raise Exception(f"Groq API error {response.status_code}: {response.text[:500]}")

    result = response.json()
    return result["choices"][0]["message"]["content"].strip()


def parse_with_claude(image_base64: str) -> str:
    """Fallback: parse sheet image using Claude Vision. Returns raw JSON text."""
    from ai_insights import get_client

    client = get_client()
    if not client:
        raise Exception("ANTHROPIC_API_KEY not configured")

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_base64,
                        },
                    },
                    {
                        "type": "text",
                        "text": VISION_PROMPT,
                    },
                ],
            }
        ],
    )
    return response.content[0].text


def extract_json(text: str) -> dict:
    """Extract JSON object from AI response text, handling markdown code blocks."""
    # Strip markdown code blocks if present
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        raise ValueError("No JSON object found in response")
    return json.loads(text[start:end])


@router.post("/parse")
def parse_photo(request: PhotoParseRequest, db: Session = Depends(get_db)):
    """Parse a photographed inventory count sheet. Uses Groq (primary) or Claude (fallback)."""
    try:
        return _do_parse(request, db)
    except Exception as e:
        print(f"Photo parse unexpected error: {e}")
        return {
            "sheet_type": "unknown",
            "dates": [],
            "unmatched_flavors": [],
            "warnings": [f"Unexpected error: {str(e)}"],
        }


def _do_parse(request: PhotoParseRequest, db: Session):
    # Build flavor lookup
    db_flavors = db.query(Flavor).filter(Flavor.active == True).all()
    flavor_map = {f.name: f.id for f in db_flavors}
    available_names = list(flavor_map.keys())

    warnings = []

    # Try Groq first, fall back to Claude
    raw = None
    if GROQ_API_KEY:
        try:
            text = parse_with_groq(request.image_base64)
            raw = extract_json(text)
        except Exception as e:
            print(f"Groq vision failed: {e}")
            warnings.append(f"Groq vision failed: {str(e)[:200]}")

    if raw is None:
        try:
            text = parse_with_claude(request.image_base64)
            raw = extract_json(text)
        except Exception as e:
            print(f"Claude vision also failed: {e}")
            warnings.append(f"Claude failed: {str(e)[:200]}")
            return {
                "sheet_type": "unknown",
                "dates": [],
                "unmatched_flavors": [],
                "warnings": warnings,
            }

    # Match flavor names to DB flavors
    unmatched = set()
    dates_out = []

    for date_data in raw.get("dates", []):
        entries_out = []
        for entry in date_data.get("entries", []):
            sheet_name = entry.get("flavor_name", "")
            matched_name = fuzzy_match_flavor(sheet_name, available_names)
            flavor_id = flavor_map.get(matched_name) if matched_name else None

            if not matched_name:
                unmatched.add(sheet_name)

            entries_out.append(
                EntryResult(
                    flavor_sheet_name=sheet_name,
                    flavor_matched_name=matched_name,
                    flavor_id=flavor_id,
                    product_type=entry.get("product_type", "tub"),
                    count=float(entry.get("count", 0)),
                    confidence=float(entry.get("confidence", 0.5)),
                )
            )

        # Deduplicate entries that matched the same flavor+product_type
        # (happens when AI splits multi-line flavor names into separate rows)
        deduped = {}
        for e in entries_out:
            if e.flavor_id is not None:
                key = (e.flavor_id, e.product_type)
                if key not in deduped or e.confidence > deduped[key].confidence:
                    deduped[key] = e
                else:
                    warnings.append(
                        f"Merged duplicate for {e.flavor_matched_name} ({e.product_type})"
                    )
            else:
                # Keep unmatched entries as-is for user review
                deduped[("unmatched", e.flavor_sheet_name, e.product_type)] = e
        entries_out = list(deduped.values())

        dates_out.append(
            DateResult(
                date=date_data.get("date", ""),
                employee_initials=date_data.get("employee_initials"),
                entries=entries_out,
            )
        )

    # Merge any AI warnings
    ai_warnings = raw.get("warnings", [])
    if ai_warnings:
        warnings.extend(ai_warnings)

    return PhotoParseResponse(
        sheet_type=raw.get("sheet_type", "unknown"),
        dates=dates_out,
        unmatched_flavors=sorted(unmatched),
        warnings=warnings,
    )
