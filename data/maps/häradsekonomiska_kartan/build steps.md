Used the following steps to generate tiles:

1. Download [map TIF](ftp://download-opendata.lantmateriet.se/Haradsekonomiska_kartan/H%C3%A4radsekonomiska_Kartan_S%C3%B6dra/J112-43-25/112_43-25_0.tif)
2. Use QGIS to output a georeferenced TIF called map_3006.tif
    - Use the points in `J112-43-25112_43-25_0.tif.points`
    - Bicubic rendering
    - Thin Plate Spline (TPS) transformation
3. Run command `gdalwarp -s_srs EPSG:3006 -t_srs EPSG:3857 map_3006.tif map_3857.vrt`
4. Run command `gdal2tiles --xyz --tiledriver=WEBP map_3857.vrt häradsekonomiska_kartan`
