import os
import json
from anthropic import Anthropic

client = None


def get_client():
    global client
    if client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return None
        client = Anthropic(api_key=api_key)
    return client


def generate_insights(inventory, consumption, alerts, production_vs_consumption):
    """Generate AI insights from current shop data using Claude."""
    c = get_client()
    if not c:
        return {
            "summary": "Set ANTHROPIC_API_KEY to enable AI insights.",
            "predictions": [],
            "make_list": [],
            "waste_flags": [],
        }

    data_context = f"""Here is the current data for an ice cream shop:

## Current Inventory
{json.dumps(inventory, indent=2, default=str)}

## Daily Consumption (last 7 days)
{json.dumps(consumption, indent=2, default=str)}

## Low Stock Alerts
{json.dumps(alerts, indent=2, default=str)}

## Production vs Consumption
{json.dumps(production_vs_consumption, indent=2, default=str)}

Today is {_today()}.
"""

    prompt = """Analyze this ice cream shop inventory data and provide:

1. **Summary**: 2-3 sentence plain English overview of the shop's current state
2. **Predictions**: Up to 5 demand predictions (e.g. "You'll likely need X pints of Y for the weekend")
3. **Make List**: Specific production recommendations for tomorrow (what to make, how many, which product type)
4. **Waste Flags**: Any flavors where production significantly exceeds consumption

Respond in this exact JSON format:
{
  "summary": "...",
  "predictions": ["prediction 1", "prediction 2", ...],
  "make_list": ["Make 4 tubs of Chocolate", "Pack 10 pints of Vanilla", ...],
  "waste_flags": ["Pistachio quarts: made 5, only sold 1 this week", ...]
}

Be specific with numbers. If data is limited, say so and give best estimates. Keep it practical and actionable for shop staff."""

    try:
        response = c.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1024,
            messages=[
                {"role": "user", "content": data_context + "\n\n" + prompt}
            ],
        )
        text = response.content[0].text
        # Extract JSON from response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        return {"summary": text, "predictions": [], "make_list": [], "waste_flags": []}
    except Exception as e:
        return {
            "summary": f"AI insights temporarily unavailable: {str(e)}",
            "predictions": [],
            "make_list": [],
            "waste_flags": [],
        }


def _today():
    from datetime import date
    return date.today().strftime("%A, %B %d, %Y")
