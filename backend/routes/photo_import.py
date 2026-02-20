from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import json
from database import get_db
from models import Flavor
from ai_insights import get_client
from routes.voice import fuzzy_match_flavor

router = APIRouter(prefix="/api/photo-import", tags=["photo-import"])


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


@router.post("/parse", response_model=PhotoParseResponse)
def parse_photo(request: PhotoParseRequest, db: Session = Depends(get_db)):
    """Parse a photographed inventory count sheet using Claude Vision."""
    client = get_client()
    if not client:
        return PhotoParseResponse(
            sheet_type="unknown",
            dates=[],
            unmatched_flavors=[],
            warnings=["ANTHROPIC_API_KEY not configured. Cannot parse photos."],
        )

    # Build flavor lookup: name -> (id, name)
    db_flavors = db.query(Flavor).filter(Flavor.is_active == True).all()
    flavor_map = {f.name: f.id for f in db_flavors}
    available_names = list(flavor_map.keys())

    try:
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
                                "data": request.image_base64,
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

        text = response.content[0].text
        # Extract JSON from response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start < 0 or end <= start:
            return PhotoParseResponse(
                sheet_type="unknown",
                dates=[],
                unmatched_flavors=[],
                warnings=["Could not parse AI response as JSON."],
            )

        raw = json.loads(text[start:end])

    except Exception as e:
        return PhotoParseResponse(
            sheet_type="unknown",
            dates=[],
            unmatched_flavors=[],
            warnings=[f"AI parsing error: {str(e)}"],
        )

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

        dates_out.append(
            DateResult(
                date=date_data.get("date", ""),
                employee_initials=date_data.get("employee_initials"),
                entries=entries_out,
            )
        )

    return PhotoParseResponse(
        sheet_type=raw.get("sheet_type", "unknown"),
        dates=dates_out,
        unmatched_flavors=sorted(unmatched),
        warnings=raw.get("warnings", []),
    )
