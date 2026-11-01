"""Geldbeträge kaufmännisch runden.

Pythons round() rundet exakte Hälften zur geraden Ziffer: 1,5 Std. x 32,75 EUR
= 49,125 ergibt 49,12 statt 49,13. Das Frontend (Math.round) rundet auf.
"""

from decimal import Decimal, ROUND_HALF_UP


def betrag_berechnen(stunden: float, stundensatz: float) -> float:
    """Stunden x Stundensatz, kaufmännisch auf Cent gerundet."""
    betrag = Decimal(str(stunden)) * Decimal(str(stundensatz))
    return float(betrag.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
