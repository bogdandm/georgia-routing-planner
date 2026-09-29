import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import pinheadSvg0 from '@waysidemapping/pinhead/dist/icons/map_pin.svg?raw';
import pinheadSvg1 from '@waysidemapping/pinhead/dist/icons/flag.svg?raw';
import pinheadSvg2 from '@waysidemapping/pinhead/dist/icons/house_with_chimney.svg?raw';
import pinheadSvg3 from '@waysidemapping/pinhead/dist/icons/p_wide.svg?raw';
import pinheadSvg4 from '@waysidemapping/pinhead/dist/icons/lowrise_apartment_building_on_ground.svg?raw';
import pinheadSvg5 from '@waysidemapping/pinhead/dist/icons/commercial_building.svg?raw';
import pinheadSvg6 from '@waysidemapping/pinhead/dist/icons/cabin.svg?raw';
import pinheadSvg7 from '@waysidemapping/pinhead/dist/icons/thatched_roof_hut.svg?raw';
import pinheadSvg8 from '@waysidemapping/pinhead/dist/icons/city_buildings.svg?raw';
import pinheadSvg9 from '@waysidemapping/pinhead/dist/icons/map_outline.svg?raw';
import pinheadSvg10 from '@waysidemapping/pinhead/dist/icons/crosshair.svg?raw';
import pinheadSvg11 from '@waysidemapping/pinhead/dist/icons/navigation_arrow_top_right.svg?raw';
import pinheadSvg12 from '@waysidemapping/pinhead/dist/icons/pin.svg?raw';
import pinheadSvg13 from '@waysidemapping/pinhead/dist/icons/crowd_of_people.svg?raw';
import pinheadSvg14 from '@waysidemapping/pinhead/dist/icons/square_academic_cap.svg?raw';
import pinheadSvg15 from '@waysidemapping/pinhead/dist/icons/compass.svg?raw';
import pinheadSvg16 from '@waysidemapping/pinhead/dist/icons/mountains_and_lake.svg?raw';
import pinheadSvg17 from '@waysidemapping/pinhead/dist/icons/conifer_tree_beside_conifer_tree.svg?raw';
import pinheadSvg18 from '@waysidemapping/pinhead/dist/icons/mountain.svg?raw';
import pinheadSvg19 from '@waysidemapping/pinhead/dist/icons/water.svg?raw';
import pinheadSvg20 from '@waysidemapping/pinhead/dist/icons/snowflake.svg?raw';
import pinheadSvg21 from '@waysidemapping/pinhead/dist/icons/beach_umbrella_in_ground.svg?raw';
import pinheadSvg22 from '@waysidemapping/pinhead/dist/icons/leaf.svg?raw';
import pinheadSvg23 from '@waysidemapping/pinhead/dist/icons/grass.svg?raw';
import pinheadSvg24 from '@waysidemapping/pinhead/dist/icons/conifer_tree_and_bench_on_ground.svg?raw';
import pinheadSvg25 from '@waysidemapping/pinhead/dist/icons/jp_hot_spring.svg?raw';
import pinheadSvg26 from '@waysidemapping/pinhead/dist/icons/cindercone_volcano_erupting.svg?raw';
import pinheadSvg27 from '@waysidemapping/pinhead/dist/icons/waters.svg?raw';
import pinheadSvg28 from '@waysidemapping/pinhead/dist/icons/sun.svg?raw';
import pinheadSvg29 from '@waysidemapping/pinhead/dist/icons/smoke_curl.svg?raw';
import pinheadSvg30 from '@waysidemapping/pinhead/dist/icons/tornado.svg?raw';
import pinheadSvg31 from '@waysidemapping/pinhead/dist/icons/exclamation_point_above_water.svg?raw';
import pinheadSvg32 from '@waysidemapping/pinhead/dist/icons/person_wearing_backpack_walking_with_hiking_pole.svg?raw';
import pinheadSvg33 from '@waysidemapping/pinhead/dist/icons/person_bicycle_racing.svg?raw';
import pinheadSvg34 from '@waysidemapping/pinhead/dist/icons/motorboat_on_water.svg?raw';
import pinheadSvg35 from '@waysidemapping/pinhead/dist/icons/pawprint.svg?raw';
import pinheadSvg36 from '@waysidemapping/pinhead/dist/icons/person_skiing_downhill.svg?raw';
import pinheadSvg37 from '@waysidemapping/pinhead/dist/icons/person_wearing_helmet_paddling_kayak_on_water.svg?raw';
import pinheadSvg38 from '@waysidemapping/pinhead/dist/icons/person_wind_surfing_on_water.svg?raw';
import pinheadSvg39 from '@waysidemapping/pinhead/dist/icons/person_piloting_hang_glider.svg?raw';
import pinheadSvg40 from '@waysidemapping/pinhead/dist/icons/person_rowing_rowboat_on_water.svg?raw';
import pinheadSvg41 from '@waysidemapping/pinhead/dist/icons/sailboat_on_water.svg?raw';
import pinheadSvg42 from '@waysidemapping/pinhead/dist/icons/person_wearing_scuba_gear_diving_under_water.svg?raw';
import pinheadSvg43 from '@waysidemapping/pinhead/dist/icons/person_riding_skateboard.svg?raw';
import pinheadSvg44 from '@waysidemapping/pinhead/dist/icons/person_snowboarding_downhill.svg?raw';
import pinheadSvg45 from '@waysidemapping/pinhead/dist/icons/trophy.svg?raw';
import pinheadSvg46 from '@waysidemapping/pinhead/dist/icons/soccer_ball.svg?raw';
import pinheadSvg47 from '@waysidemapping/pinhead/dist/icons/person_riding_surfboard.svg?raw';
import pinheadSvg48 from '@waysidemapping/pinhead/dist/icons/person_swimming_in_water.svg?raw';
import pinheadSvg49 from '@waysidemapping/pinhead/dist/icons/person_running.svg?raw';
import pinheadSvg50 from '@waysidemapping/pinhead/dist/icons/fork_and_knife.svg?raw';
import pinheadSvg51 from '@waysidemapping/pinhead/dist/icons/coffee_mug_with_steam.svg?raw';
import pinheadSvg52 from '@waysidemapping/pinhead/dist/icons/bed.svg?raw';
import pinheadSvg53 from '@waysidemapping/pinhead/dist/icons/shopping_bag.svg?raw';
import pinheadSvg54 from '@waysidemapping/pinhead/dist/icons/loaf_of_bread.svg?raw';
import pinheadSvg55 from '@waysidemapping/pinhead/dist/icons/egg.svg?raw';
import pinheadSvg56 from '@waysidemapping/pinhead/dist/icons/campsite.svg?raw';
import pinheadSvg57 from '@waysidemapping/pinhead/dist/icons/burger_and_drink_cup_with_straw.svg?raw';
import pinheadSvg58 from '@waysidemapping/pinhead/dist/icons/ice_cream_on_cone.svg?raw';
import pinheadSvg59 from '@waysidemapping/pinhead/dist/icons/wine_bottle.svg?raw';
import pinheadSvg60 from '@waysidemapping/pinhead/dist/icons/cocktail.svg?raw';
import pinheadSvg61 from '@waysidemapping/pinhead/dist/icons/table_with_chairs.svg?raw';
import pinheadSvg62 from '@waysidemapping/pinhead/dist/icons/water_tap_with_drinking_glass.svg?raw';
import pinheadSvg63 from '@waysidemapping/pinhead/dist/icons/shopping_basket.svg?raw';
import pinheadSvg64 from '@waysidemapping/pinhead/dist/icons/shelter.svg?raw';
import pinheadSvg65 from '@waysidemapping/pinhead/dist/icons/noodle_bowl_and_chopsticks_with_noodles.svg?raw';
import pinheadSvg66 from '@waysidemapping/pinhead/dist/icons/fish.svg?raw';
import pinheadSvg67 from '@waysidemapping/pinhead/dist/icons/fork_and_spoon.svg?raw';
import pinheadSvg68 from '@waysidemapping/pinhead/dist/icons/camera.svg?raw';
import pinheadSvg69 from '@waysidemapping/pinhead/dist/icons/castle.svg?raw';
import pinheadSvg70 from '@waysidemapping/pinhead/dist/icons/chapel.svg?raw';
import pinheadSvg71 from '@waysidemapping/pinhead/dist/icons/classical_building.svg?raw';
import pinheadSvg72 from '@waysidemapping/pinhead/dist/icons/obelisk_on_plinth.svg?raw';
import pinheadSvg73 from '@waysidemapping/pinhead/dist/icons/star.svg?raw';
import pinheadSvg74 from '@waysidemapping/pinhead/dist/icons/party_popper.svg?raw';
import pinheadSvg75 from '@waysidemapping/pinhead/dist/icons/pier_on_water.svg?raw';
import pinheadSvg76 from '@waysidemapping/pinhead/dist/icons/big_top_tent_with_pennant.svg?raw';
import pinheadSvg77 from '@waysidemapping/pinhead/dist/icons/fort.svg?raw';
import pinheadSvg78 from '@waysidemapping/pinhead/dist/icons/dome_with_crescent_moon_and_star_and_planet.svg?raw';
import pinheadSvg79 from '@waysidemapping/pinhead/dist/icons/star_of_david_on_square.svg?raw';
import pinheadSvg80 from '@waysidemapping/pinhead/dist/icons/dharma_wheel_on_square.svg?raw';
import pinheadSvg81 from '@waysidemapping/pinhead/dist/icons/om_on_square.svg?raw';
import pinheadSvg82 from '@waysidemapping/pinhead/dist/icons/comedy_mask_and_tragedy_mask.svg?raw';
import pinheadSvg83 from '@waysidemapping/pinhead/dist/icons/tour_van.svg?raw';
import pinheadSvg84 from '@waysidemapping/pinhead/dist/icons/manor.svg?raw';
import pinheadSvg85 from '@waysidemapping/pinhead/dist/icons/hospital_h.svg?raw';
import pinheadSvg86 from '@waysidemapping/pinhead/dist/icons/stethoscope.svg?raw';
import pinheadSvg87 from '@waysidemapping/pinhead/dist/icons/info_i.svg?raw';
import pinheadSvg88 from '@waysidemapping/pinhead/dist/icons/triangle_up_with_exclamation_point.svg?raw';
import pinheadSvg89 from '@waysidemapping/pinhead/dist/icons/barricade.svg?raw';
import pinheadSvg90 from '@waysidemapping/pinhead/dist/icons/no_entry.svg?raw';
import pinheadSvg91 from '@waysidemapping/pinhead/dist/icons/junk_car.svg?raw';
import pinheadSvg92 from '@waysidemapping/pinhead/dist/icons/bell.svg?raw';
import pinheadSvg93 from '@waysidemapping/pinhead/dist/icons/skull_above_crossed_bones.svg?raw';
import pinheadSvg94 from '@waysidemapping/pinhead/dist/icons/nine_one_one.svg?raw';
import pinheadSvg95 from '@waysidemapping/pinhead/dist/icons/steel_square_and_drafting_compass.svg?raw';
import pinheadSvg96 from '@waysidemapping/pinhead/dist/icons/fire_extinguisher.svg?raw';
import pinheadSvg97 from '@waysidemapping/pinhead/dist/icons/shield.svg?raw';
import pinheadSvg98 from '@waysidemapping/pinhead/dist/icons/jp_fire_station.svg?raw';
import pinheadSvg99 from '@waysidemapping/pinhead/dist/icons/paper_and_pencil.svg?raw';
import pinheadSvg100 from '@waysidemapping/pinhead/dist/icons/locked_lock.svg?raw';
import pinheadSvg101 from '@waysidemapping/pinhead/dist/icons/sos_text.svg?raw';
import pinheadSvg102 from '@waysidemapping/pinhead/dist/icons/traffic_cone.svg?raw';
import pinheadSvg103 from '@waysidemapping/pinhead/dist/icons/binoculars.svg?raw';
import pinheadSvg104 from '@waysidemapping/pinhead/dist/icons/bus_with_destination_display.svg?raw';
import pinheadSvg105 from '@waysidemapping/pinhead/dist/icons/people_in_car.svg?raw';
import pinheadSvg106 from '@waysidemapping/pinhead/dist/icons/bus.svg?raw';
import pinheadSvg107 from '@waysidemapping/pinhead/dist/icons/car.svg?raw';
import pinheadSvg108 from '@waysidemapping/pinhead/dist/icons/railway_track.svg?raw';
import pinheadSvg109 from '@waysidemapping/pinhead/dist/icons/bicycle.svg?raw';
import pinheadSvg110 from '@waysidemapping/pinhead/dist/icons/plane_takeoff_above_ground.svg?raw';
import pinheadSvg111 from '@waysidemapping/pinhead/dist/icons/gasoline_pump.svg?raw';
import pinheadSvg112 from '@waysidemapping/pinhead/dist/icons/pixel_bicycle.svg?raw';
import pinheadSvg113 from '@waysidemapping/pinhead/dist/icons/snowmobile.svg?raw';
import pinheadSvg114 from '@waysidemapping/pinhead/dist/icons/steam_train.svg?raw';
import pinheadSvg115 from '@waysidemapping/pinhead/dist/icons/tram_on_tram_track.svg?raw';
import pinheadSvg116 from '@waysidemapping/pinhead/dist/icons/motorcycle.svg?raw';
import pinheadSvg117 from '@waysidemapping/pinhead/dist/icons/telescope.svg?raw';
import pinheadSvg118 from '@waysidemapping/pinhead/dist/icons/crescent.svg?raw';
import pinheadSvg119 from '@waysidemapping/pinhead/dist/icons/tree_on_hill_in_water.svg?raw';
import pinheadSvg120 from '@waysidemapping/pinhead/dist/icons/waterfall.svg?raw';
import pinheadSvg121 from '@waysidemapping/pinhead/dist/icons/cave.svg?raw';
import pinheadSvg122 from '@waysidemapping/pinhead/dist/icons/cliff_with_rocks.svg?raw';
import pinheadSvg123 from '@waysidemapping/pinhead/dist/icons/snowcapped_mountain_valley.svg?raw';
import pinheadSvg124 from '@waysidemapping/pinhead/dist/icons/pointy_rock.svg?raw';
import pinheadSvg125 from '@waysidemapping/pinhead/dist/icons/bear.svg?raw';
import pinheadSvg126 from '@waysidemapping/pinhead/dist/icons/deer_with_antlers.svg?raw';
import pinheadSvg127 from '@waysidemapping/pinhead/dist/icons/bird_flying.svg?raw';
import pinheadSvg128 from '@waysidemapping/pinhead/dist/icons/conifer_tree_and_flower_and_mountain_snowcapped.svg?raw';
import pinheadSvg129 from '@waysidemapping/pinhead/dist/icons/typha_in_water.svg?raw';

import type { MarkerColorKey, MarkerIconKey } from '@/domain/markers/savedMarker';
import { appColors } from '@/presentation/theme/appColors';

export const markerIconCategories = [
  'Places',
  'Nature',
  'Activities',
  'Food & stay',
  'Landmarks',
  'Safety',
  'Transport',
] as const;

export type MarkerIconCategory = (typeof markerIconCategories)[number];

export interface MarkerIconCatalogEntry {
  readonly key: MarkerIconKey;
  readonly label: string;
  readonly labelMessage: MessageDescriptor;
  readonly category: MarkerIconCategory;
  readonly svg: string;
}

function icon(
  key: MarkerIconKey,
  label: string,
  labelMessage: MessageDescriptor,
  category: MarkerIconCategory,
  svg: string,
): MarkerIconCatalogEntry {
  return { key, label, labelMessage, category, svg };
}

export const markerIconCatalog = [
  icon('place', 'Place', msg({ message: 'Place' }), 'Places', pinheadSvg0),
  icon('flag', 'Flag', msg({ message: 'Flag' }), 'Places', pinheadSvg1),
  icon('home', 'Home', msg({ message: 'Home' }), 'Places', pinheadSvg2),
  icon('parking', 'Parking', msg({ message: 'Parking' }), 'Places', pinheadSvg3),
  icon('apartment', 'Apartment', msg({ message: 'Apartment' }), 'Places', pinheadSvg4),
  icon('business', 'Business', msg({ message: 'Business' }), 'Places', pinheadSvg5),
  icon('cabin', 'Cabin', msg({ message: 'Cabin' }), 'Places', pinheadSvg6),
  icon('cottage', 'Cottage', msg({ message: 'Cottage' }), 'Places', pinheadSvg7),
  icon('city', 'City', msg({ message: 'City' }), 'Places', pinheadSvg8),
  icon('map', 'Map', msg({ message: 'Map' }), 'Places', pinheadSvg9),
  icon(
    'my-location',
    'My location',
    msg({ message: 'My location' }),
    'Places',
    pinheadSvg10,
  ),
  icon(
    'navigation',
    'Navigation',
    msg({ message: 'Navigation' }),
    'Places',
    pinheadSvg11,
  ),
  icon('pin', 'Pin', msg({ message: 'Pin' }), 'Places', pinheadSvg12),
  icon(
    'public',
    'Public place',
    msg({ message: 'Public place' }),
    'Places',
    pinheadSvg13,
  ),
  icon('school', 'School', msg({ message: 'School' }), 'Places', pinheadSvg14),
  icon('explore', 'Explore', msg({ message: 'Explore' }), 'Places', pinheadSvg15),
  icon('landscape', 'Landscape', msg({ message: 'Landscape' }), 'Nature', pinheadSvg16),
  icon('forest', 'Forest', msg({ message: 'Forest' }), 'Nature', pinheadSvg17),
  icon('terrain', 'Terrain', msg({ message: 'Terrain' }), 'Nature', pinheadSvg18),
  icon('water', 'Water', msg({ message: 'Water' }), 'Nature', pinheadSvg19),
  icon('snow', 'Snow', msg({ message: 'Snow' }), 'Nature', pinheadSvg20),
  icon('beach', 'Beach', msg({ message: 'Beach' }), 'Nature', pinheadSvg21),
  icon('eco', 'Eco', msg({ message: 'Eco' }), 'Nature', pinheadSvg22),
  icon('grass', 'Grass', msg({ message: 'Grass' }), 'Nature', pinheadSvg23),
  icon('park', 'Park', msg({ message: 'Park' }), 'Nature', pinheadSvg24),
  icon('spa', 'Spring', msg({ message: 'Spring' }), 'Nature', pinheadSvg25),
  icon('volcano', 'Volcano', msg({ message: 'Volcano' }), 'Nature', pinheadSvg26),
  icon('waves', 'Waves', msg({ message: 'Waves' }), 'Nature', pinheadSvg27),
  icon('sunny', 'Sunny', msg({ message: 'Sunny' }), 'Nature', pinheadSvg28),
  icon('cloud', 'Cloud', msg({ message: 'Cloud' }), 'Nature', pinheadSvg29),
  icon('storm', 'Storm', msg({ message: 'Storm' }), 'Nature', pinheadSvg30),
  icon('tsunami', 'Tsunami', msg({ message: 'Tsunami' }), 'Nature', pinheadSvg31),
  icon(
    'telescope',
    'Telescope',
    msg({ message: 'Telescope' }),
    'Nature',
    pinheadSvg117,
  ),
  icon('moon', 'Moon', msg({ message: 'Moon' }), 'Nature', pinheadSvg118),
  icon('lake', 'Lake', msg({ message: 'Lake' }), 'Nature', pinheadSvg119),
  icon(
    'viewpoint',
    'Viewpoint',
    msg({ message: 'Viewpoint' }),
    'Nature',
    pinheadSvg103,
  ),
  icon(
    'waterfall',
    'Waterfall',
    msg({ message: 'Waterfall' }),
    'Nature',
    pinheadSvg120,
  ),
  icon('cave', 'Cave', msg({ message: 'Cave' }), 'Nature', pinheadSvg121),
  icon('cliff', 'Cliff', msg({ message: 'Cliff' }), 'Nature', pinheadSvg122),
  icon('valley', 'Valley', msg({ message: 'Valley' }), 'Nature', pinheadSvg123),
  icon('rock', 'Rock', msg({ message: 'Rock' }), 'Nature', pinheadSvg124),
  icon('bear', 'Bear', msg({ message: 'Bear' }), 'Nature', pinheadSvg125),
  icon('deer', 'Deer', msg({ message: 'Deer' }), 'Nature', pinheadSvg126),
  icon('bird', 'Bird', msg({ message: 'Bird' }), 'Nature', pinheadSvg127),
  icon(
    'wildflowers',
    'Wildflowers',
    msg({ message: 'Wildflowers' }),
    'Nature',
    pinheadSvg128,
  ),
  icon('wetland', 'Wetland', msg({ message: 'Wetland' }), 'Nature', pinheadSvg129),
  icon('hiking', 'Hiking', msg({ message: 'Hiking' }), 'Activities', pinheadSvg32),
  icon('cycling', 'Cycling', msg({ message: 'Cycling' }), 'Activities', pinheadSvg33),
  icon('boating', 'Boating', msg({ message: 'Boating' }), 'Activities', pinheadSvg34),
  icon('pets', 'Pets', msg({ message: 'Pets' }), 'Activities', pinheadSvg35),
  icon('skiing', 'Skiing', msg({ message: 'Skiing' }), 'Activities', pinheadSvg36),
  icon(
    'kayaking',
    'Kayaking',
    msg({ message: 'Kayaking' }),
    'Activities',
    pinheadSvg37,
  ),
  icon(
    'kitesurfing',
    'Kitesurfing',
    msg({ message: 'Kitesurfing' }),
    'Activities',
    pinheadSvg38,
  ),
  icon(
    'paragliding',
    'Paragliding',
    msg({ message: 'Paragliding' }),
    'Activities',
    pinheadSvg39,
  ),
  icon('rowing', 'Rowing', msg({ message: 'Rowing' }), 'Activities', pinheadSvg40),
  icon('sailing', 'Sailing', msg({ message: 'Sailing' }), 'Activities', pinheadSvg41),
  icon('diving', 'Diving', msg({ message: 'Diving' }), 'Activities', pinheadSvg42),
  icon(
    'skateboarding',
    'Skateboarding',
    msg({ message: 'Skateboarding' }),
    'Activities',
    pinheadSvg43,
  ),
  icon(
    'snowboarding',
    'Snowboarding',
    msg({ message: 'Snowboarding' }),
    'Activities',
    pinheadSvg44,
  ),
  icon('sports', 'Sports', msg({ message: 'Sports' }), 'Activities', pinheadSvg45),
  icon(
    'football',
    'Football',
    msg({ message: 'Football' }),
    'Activities',
    pinheadSvg46,
  ),
  icon('surfing', 'Surfing', msg({ message: 'Surfing' }), 'Activities', pinheadSvg47),
  icon(
    'swimming',
    'Swimming',
    msg({ message: 'Swimming' }),
    'Activities',
    pinheadSvg48,
  ),
  icon('running', 'Running', msg({ message: 'Running' }), 'Activities', pinheadSvg49),
  icon(
    'restaurant',
    'Restaurant',
    msg({ message: 'Restaurant' }),
    'Food & stay',
    pinheadSvg50,
  ),
  icon('cafe', 'Cafe', msg({ message: 'Cafe' }), 'Food & stay', pinheadSvg51),
  icon('hotel', 'Hotel', msg({ message: 'Hotel' }), 'Food & stay', pinheadSvg52),
  icon('store', 'Store', msg({ message: 'Store' }), 'Food & stay', pinheadSvg53),
  icon('bakery', 'Bakery', msg({ message: 'Bakery' }), 'Food & stay', pinheadSvg54),
  icon('brunch', 'Brunch', msg({ message: 'Brunch' }), 'Food & stay', pinheadSvg55),
  icon('camping', 'Camping', msg({ message: 'Camping' }), 'Food & stay', pinheadSvg56),
  icon(
    'fast-food',
    'Fast food',
    msg({ message: 'Fast food' }),
    'Food & stay',
    pinheadSvg57,
  ),
  icon(
    'ice-cream',
    'Ice cream',
    msg({ message: 'Ice cream' }),
    'Food & stay',
    pinheadSvg58,
  ),
  icon('liquor', 'Liquor', msg({ message: 'Liquor' }), 'Food & stay', pinheadSvg59),
  icon('bar', 'Bar', msg({ message: 'Bar' }), 'Food & stay', pinheadSvg60),
  icon('dining', 'Dining', msg({ message: 'Dining' }), 'Food & stay', pinheadSvg61),
  icon(
    'drinking-water',
    'Drinking water',
    msg({ message: 'Drinking water' }),
    'Food & stay',
    pinheadSvg62,
  ),
  icon('grocery', 'Grocery', msg({ message: 'Grocery' }), 'Food & stay', pinheadSvg63),
  icon('shelter', 'Shelter', msg({ message: 'Shelter' }), 'Food & stay', pinheadSvg64),
  icon('ramen', 'Ramen', msg({ message: 'Ramen' }), 'Food & stay', pinheadSvg65),
  icon('seafood', 'Seafood', msg({ message: 'Seafood' }), 'Food & stay', pinheadSvg66),
  icon('tapas', 'Tapas', msg({ message: 'Tapas' }), 'Food & stay', pinheadSvg67),
  icon('camera', 'Camera', msg({ message: 'Camera' }), 'Landmarks', pinheadSvg68),
  icon('castle', 'Castle', msg({ message: 'Castle' }), 'Landmarks', pinheadSvg69),
  icon('church', 'Church', msg({ message: 'Church' }), 'Landmarks', pinheadSvg70),
  icon('museum', 'Museum', msg({ message: 'Museum' }), 'Landmarks', pinheadSvg71),
  icon('monument', 'Monument', msg({ message: 'Monument' }), 'Landmarks', pinheadSvg72),
  icon(
    'attraction',
    'Attraction',
    msg({ message: 'Attraction' }),
    'Landmarks',
    pinheadSvg73,
  ),
  icon(
    'celebration',
    'Celebration',
    msg({ message: 'Celebration' }),
    'Landmarks',
    pinheadSvg74,
  ),
  icon('deck', 'Deck', msg({ message: 'Deck' }), 'Landmarks', pinheadSvg75),
  icon('festival', 'Festival', msg({ message: 'Festival' }), 'Landmarks', pinheadSvg76),
  icon('fort', 'Fort', msg({ message: 'Fort' }), 'Landmarks', pinheadSvg77),
  icon('mosque', 'Mosque', msg({ message: 'Mosque' }), 'Landmarks', pinheadSvg78),
  icon(
    'synagogue',
    'Synagogue',
    msg({ message: 'Synagogue' }),
    'Landmarks',
    pinheadSvg79,
  ),
  icon(
    'buddhist-temple',
    'Buddhist temple',
    msg({ message: 'Buddhist temple' }),
    'Landmarks',
    pinheadSvg80,
  ),
  icon(
    'hindu-temple',
    'Hindu temple',
    msg({ message: 'Hindu temple' }),
    'Landmarks',
    pinheadSvg81,
  ),
  icon('theater', 'Theater', msg({ message: 'Theater' }), 'Landmarks', pinheadSvg82),
  icon('tour', 'Tour', msg({ message: 'Tour' }), 'Landmarks', pinheadSvg83),
  icon('villa', 'Villa', msg({ message: 'Villa' }), 'Landmarks', pinheadSvg84),
  icon('hospital', 'Hospital', msg({ message: 'Hospital' }), 'Safety', pinheadSvg85),
  icon('medical', 'Medical', msg({ message: 'Medical' }), 'Safety', pinheadSvg86),
  icon('info', 'Info', msg({ message: 'Info' }), 'Safety', pinheadSvg87),
  icon('warning', 'Warning', msg({ message: 'Warning' }), 'Safety', pinheadSvg88),
  icon('roadwork', 'Roadwork', msg({ message: 'Roadwork' }), 'Safety', pinheadSvg89),
  icon('blocked', 'Blocked', msg({ message: 'Blocked' }), 'Safety', pinheadSvg90),
  icon('car-crash', 'Car crash', msg({ message: 'Car crash' }), 'Safety', pinheadSvg91),
  icon('alert', 'Alert', msg({ message: 'Alert' }), 'Safety', pinheadSvg92),
  icon('danger', 'Danger', msg({ message: 'Danger' }), 'Safety', pinheadSvg93),
  icon('emergency', 'Emergency', msg({ message: 'Emergency' }), 'Safety', pinheadSvg94),
  icon(
    'engineering',
    'Engineering',
    msg({ message: 'Engineering' }),
    'Safety',
    pinheadSvg95,
  ),
  icon(
    'fire-extinguisher',
    'Fire extinguisher',
    msg({ message: 'Fire extinguisher' }),
    'Safety',
    pinheadSvg96,
  ),
  icon('safety', 'Safety', msg({ message: 'Safety' }), 'Safety', pinheadSvg97),
  icon(
    'fire-station',
    'Fire station',
    msg({ message: 'Fire station' }),
    'Safety',
    pinheadSvg98,
  ),
  icon('report', 'Report', msg({ message: 'Report' }), 'Safety', pinheadSvg99),
  icon('security', 'Security', msg({ message: 'Security' }), 'Safety', pinheadSvg100),
  icon('sos', 'SOS', msg({ message: 'SOS' }), 'Safety', pinheadSvg101),
  icon('traffic', 'Traffic', msg({ message: 'Traffic' }), 'Safety', pinheadSvg102),
  icon('shuttle', 'Shuttle', msg({ message: 'Shuttle' }), 'Transport', pinheadSvg104),
  icon('commute', 'Commute', msg({ message: 'Commute' }), 'Transport', pinheadSvg105),
  icon('bus', 'Bus', msg({ message: 'Bus' }), 'Transport', pinheadSvg106),
  icon('car', 'Car', msg({ message: 'Car' }), 'Transport', pinheadSvg107),
  icon('railway', 'Railway', msg({ message: 'Railway' }), 'Transport', pinheadSvg108),
  icon(
    'electric-bike',
    'Electric bike',
    msg({ message: 'Electric bike' }),
    'Transport',
    pinheadSvg109,
  ),
  icon('flight', 'Flight', msg({ message: 'Flight' }), 'Transport', pinheadSvg110),
  icon('fuel', 'Fuel', msg({ message: 'Fuel' }), 'Transport', pinheadSvg111),
  icon('bike', 'Bike', msg({ message: 'Bike' }), 'Transport', pinheadSvg112),
  icon(
    'snowmobile',
    'Snowmobile',
    msg({ message: 'Snowmobile' }),
    'Transport',
    pinheadSvg113,
  ),
  icon('train', 'Train', msg({ message: 'Train' }), 'Transport', pinheadSvg114),
  icon('tram', 'Tram', msg({ message: 'Tram' }), 'Transport', pinheadSvg115),
  icon(
    'motorcycle',
    'Motorcycle',
    msg({ message: 'Motorcycle' }),
    'Transport',
    pinheadSvg116,
  ),
] as const satisfies readonly MarkerIconCatalogEntry[];

export const markerIconOrder = Object.fromEntries(
  markerIconCatalog.map(({ key }, index) => [key, index]),
) as Readonly<Record<MarkerIconKey, number>>;

export interface MarkerColorCatalogEntry {
  readonly key: MarkerColorKey;
  readonly label: string;
  readonly value: string;
}

export const markerColorCatalog = [
  { key: 'blue', label: 'Blue', value: appColors.marker.blue },
  { key: 'teal', label: 'Teal', value: appColors.marker.teal },
  { key: 'purple', label: 'Purple', value: appColors.marker.purple },
  { key: 'olive', label: 'Olive', value: appColors.marker.olive },
  { key: 'orange', label: 'Orange', value: appColors.marker.orange },
  { key: 'rose', label: 'Rose', value: appColors.marker.rose },
  { key: 'navy', label: 'Navy', value: appColors.marker.navy },
  { key: 'blue-green', label: 'Blue-green', value: appColors.marker.blueGreen },
  { key: 'green', label: 'Green', value: appColors.marker.green },
  { key: 'red', label: 'Red', value: appColors.marker.red },
] as const satisfies readonly MarkerColorCatalogEntry[];

export const markerColorOrder: Readonly<Record<MarkerColorKey, number>> = {
  blue: 0,
  teal: 1,
  purple: 2,
  olive: 3,
  orange: 4,
  rose: 5,
  navy: 6,
  'blue-green': 7,
  green: 8,
  red: 9,
};

export function markerIconFor(key: MarkerIconKey): MarkerIconCatalogEntry {
  const entry = markerIconCatalog.find((candidate) => candidate.key === key);
  if (entry === undefined) throw new Error(`Unknown marker icon key: ${key}`);
  return entry;
}

export function markerColorFor(key: MarkerColorKey): MarkerColorCatalogEntry {
  const entry = markerColorCatalog.find((candidate) => candidate.key === key);
  if (entry === undefined) throw new Error(`Unknown marker color key: ${key}`);
  return entry;
}

export async function createMarkerIconImage(
  iconKey: MarkerIconKey,
  colorKey: MarkerColorKey,
): Promise<HTMLImageElement> {
  const iconSvg = markerIconFor(iconKey).svg;
  const color = markerColorFor(colorKey).value;
  const svg = iconSvg.replace(
    '<svg ',
    `<svg width="40" height="40" fill="${color}" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke fill" `,
  );
  const image = new Image(40, 40);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  return image;
}
