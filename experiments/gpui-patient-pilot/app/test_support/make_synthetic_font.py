from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from pathlib import Path
fb=FontBuilder(1000,isTTF=True);fb.setupGlyphOrder(['.notdef','syntheticThree']);fb.setupCharacterMap({51:'syntheticThree'})
p=TTGlyphPen(None);p.moveTo((80,0));p.lineTo((520,0));p.lineTo((520,700));p.lineTo((80,700));p.closePath()
fb.setupGlyf({'.notdef':TTGlyphPen(None).glyph(),'syntheticThree':p.glyph()});fb.setupHorizontalMetrics({'.notdef':(600,0),'syntheticThree':(600,80)});fb.setupHorizontalHeader(ascent=800,descent=-200);fb.setupNameTable({'familyName':'MediFlow Synthetic','styleName':'Regular','uniqueFontIdentifier':'MediFlowSynthetic-1','fullName':'MediFlow Synthetic','psName':'MediFlowSynthetic','version':'Version 1.0'});fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200);fb.setupPost();fb.setupMaxp();fb.font['head'].created=fb.font['head'].modified=3406620150
fb.font.recalcTimestamp=False
fb.save('experiments/gpui-patient-pilot/app/test_support/synthetic-glyph-font.ttf')
