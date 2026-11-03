from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
import pikepdf,io
b=Path(__file__).parent/'pdf-glyphs';fb=FontBuilder(1000,isTTF=True);fb.setupGlyphOrder(['.notdef','space','syntheticThree']);fb.setupCharacterMap({32:'space',51:'syntheticThree'})
p=TTGlyphPen(None);p.moveTo((50,0));p.lineTo((500,0));p.lineTo((500,700));p.closePath();fb.setupGlyf({'.notdef':TTGlyphPen(None).glyph(),'space':TTGlyphPen(None).glyph(),'syntheticThree':p.glyph()});fb.setupHorizontalMetrics({'.notdef':(278,0),'space':(278,0),'syntheticThree':(600,0)});fb.setupHorizontalHeader(ascent=800,descent=-200);fb.setupNameTable({'familyName':'MediFlow CID Proof','styleName':'Regular','uniqueFontIdentifier':'MediFlowCIDProof','fullName':'MediFlow CID Proof','psName':'MediFlowCIDProof','version':'Version 1.0'});fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200);fb.setupPost();fb.setupMaxp();fb.font.recalcTimestamp=False;fb.font['head'].created=fb.font['head'].modified=3406620150;out=io.BytesIO();fb.save(out);font_bytes=out.getvalue()
N=pikepdf.Name;D=pikepdf.Dictionary;A=pikepdf.Array
for label,gid in [('space',1),('notdef',0)]:
 pdf=pikepdf.Pdf.new();page=pdf.add_blank_page(page_size=(100,60));fontfile=pdf.make_stream(font_bytes);descriptor=D(Type=N.FontDescriptor,FontName=N.MediFlowCIDProof,Flags=32,FontBBox=A([0,0,600,800]),ItalicAngle=0,Ascent=800,Descent=-200,CapHeight=700,StemV=80,FontFile2=fontfile)
 mapping=bytearray(66);mapping[64:66]=gid.to_bytes(2,'big');cid=D(Type=N.Font,Subtype=N.CIDFontType2,BaseFont=N.MediFlowCIDProof,CIDSystemInfo=D(Registry='Adobe',Ordering='Identity',Supplement=0),FontDescriptor=pdf.make_indirect(descriptor),CIDToGIDMap=pdf.make_stream(bytes(mapping)),DW=278,W=A([32,A([278])]))
 cmap=b'/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /MediFlowProof def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0020> <0020> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end'
 font=D(Type=N.Font,Subtype=N.Type0,BaseFont=N.MediFlowCIDProof,Encoding=N('/Identity-H'),DescendantFonts=A([pdf.make_indirect(cid)]),ToUnicode=pdf.make_stream(cmap))
 page.Resources=D(Font=D(F1=pdf.make_indirect(font)));page.Contents=pdf.make_stream(b'BT /F1 12 Tf 10 20 Td <0020> Tj ET');pdf.save(b/('cid-ambiguity-'+label+'.pdf'),compress_streams=False)
